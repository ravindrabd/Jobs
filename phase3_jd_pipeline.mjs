// Unified JD-fetch pipeline:
//  • Scrapes AHIMA (new source).
//  • Backfills jd_text + match against resume for HIMSS (25) and us-rse (13) existing rows.
//  • Sets show_flag = 1 iff ≥1 resume-skill is found in the JD (alias-aware).
//
// HEDjobs full JD-fetch is intentionally skipped here — at 2,076 jobs × Playwright,
// it'd be ~10–30 min on its own. The on-click /api/jobs/:id/fetch-jd endpoint
// handles HEDjobs lazily instead.

import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'fs/promises';
import * as cheerio from 'cheerio';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { fetchJdText, matchAgainstJd, closeBrowser } = require('./jd_fetch.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const db = new DatabaseSync('jobs.db');
db.exec('PRAGMA journal_mode = WAL');

// Read the current resume (parsed JSON)
const resumeRow = db.prepare('SELECT resume_parsed FROM resume WHERE id = 1').get();
if (!resumeRow) { console.error('No resume on file — upload one first.'); process.exit(1); }
const resume = JSON.parse(resumeRow.resume_parsed);
console.log('Resume loaded:', resume.skills.length, 'skills');

function csvEsc(s) { if (s == null) return ''; s = String(s); return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

// ---------- Scrape AHIMA (new source) ----------
async function scrapeAhima() {
  // AHIMA returns 403 to Node fetch but 200 to a real browser — use Playwright.
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled','--no-sandbox'] });
  let html = '';
  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
    const page = await ctx.newPage();
    await page.goto('https://careerassist.ahima.org/jobs/', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);
    html = await page.content();
  } finally { try { await browser.close(); } catch {} }
  if (!html) { console.error('AHIMA: empty html'); return []; }
  const $ = cheerio.load(html);
  const jobs = [];
  const seen = new Set();
  for (const a of $('a[href*="/job/"]').toArray()) {
    const href = $(a).attr('href') || '';
    if (!/\/job\/[a-z0-9-]+\/\d+\//.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    const title = $(a).text().replace(/\s+/g, ' ').trim();
    if (!title || title.length < 4) continue;
    jobs.push({
      title,
      url: 'https://careerassist.ahima.org' + href,
      organization: 'Healthcare (via AHIMA Career Center)',
      org_type: 'hospital',
      location: '',
      salary: '',
      posted_date: '',
      ats_platform: 'ahima',
      source_domain: 'careerassist.ahima.org',
    });
  }
  return jobs;
}

// ---------- Process a single job: insert/update + JD fetch + match ----------
const upsert = db.prepare(`
  INSERT INTO jobs (title, organization, org_type, location, remote, salary, posted_date, posted_date_iso,
                    url, ats_platform, source_domain, scraped_at, competition_level, dedup_key,
                    jd_text, jd_fetched_at, matched_skills, missing_skills, match_score, show_flag)
  VALUES (@title, @organization, @org_type, @location, 'no', @salary, '', NULL,
          @url, @ats_platform, @source_domain, datetime('now'), 'low', @dedup_key,
          @jd_text, datetime('now'), @matched_skills, @missing_skills, @match_score, @show_flag)
  ON CONFLICT(url) DO UPDATE SET
    jd_text = excluded.jd_text,
    jd_fetched_at = datetime('now'),
    matched_skills = excluded.matched_skills,
    missing_skills = excluded.missing_skills,
    match_score = excluded.match_score,
    show_flag = excluded.show_flag
`);

function norm(s) { return (s || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(); }

async function processOne(job, src) {
  const jdText = await fetchJdText(job.url);
  if (!jdText) return { ok: false, reason: 'jd_fetch_failed' };
  const m = matchAgainstJd(jdText, resume);
  const show = m.matched_skills.length >= 1 ? 1 : 0;
  upsert.run({
    title: job.title, organization: job.organization || 'Unknown', org_type: job.org_type || 'university',
    location: job.location || '', salary: job.salary || '',
    url: job.url, ats_platform: job.ats_platform || src, source_domain: job.source_domain || '',
    dedup_key: `${norm(job.title)}|${norm(job.organization)}|${norm(job.location)}`,
    jd_text: jdText,
    matched_skills: JSON.stringify(m.matched_skills),
    missing_skills: JSON.stringify(m.missing_skills),
    match_score: m.score,
    show_flag: show,
  });
  return { ok: true, score: m.score, show, matched: m.matched_skills.length };
}

// ---------- Backfill JD for an existing DB row ----------
async function backfillRow(row) {
  const jdText = await fetchJdText(row.url);
  if (!jdText) return { ok: false };
  const m = matchAgainstJd(jdText, resume);
  const show = m.matched_skills.length >= 1 ? 1 : 0;
  db.prepare(`UPDATE jobs SET jd_text=?, jd_fetched_at=datetime('now'),
              matched_skills=?, missing_skills=?, match_score=?, show_flag=?
              WHERE id=?`).run(
    jdText, JSON.stringify(m.matched_skills), JSON.stringify(m.missing_skills), m.score, show, row.id);
  return { ok: true, score: m.score, show, matched: m.matched_skills.length };
}

// ========== RUN ==========
const totals = {};
function recordResult(src, r) {
  const t = totals[src] = totals[src] || { attempted: 0, jd_ok: 0, matched_ge_1: 0, shown: 0 };
  t.attempted++;
  if (r.ok) {
    t.jd_ok++;
    if (r.matched >= 1) { t.matched_ge_1++; t.shown += r.show; }
  }
}

console.log('\n========== 1) AHIMA — scrape + JD fetch + match ==========');
const ahima = await scrapeAhima();
console.log('AHIMA scraped:', ahima.length, 'jobs');
for (let i = 0; i < ahima.length; i++) {
  const r = await processOne(ahima[i], 'ahima');
  recordResult('ahima', r);
  if ((i + 1) % 5 === 0 || i === ahima.length - 1) console.log(`  [${i+1}/${ahima.length}]`, r.ok ? `score=${r.score}% matched=${r.matched} show=${r.show}` : 'failed');
}

console.log('\n========== 2) us-rse — backfill JD ==========');
const rseRows = db.prepare(`SELECT id, url FROM jobs WHERE ats_platform='us-rse' AND jd_text IS NULL AND removed=0`).all();
console.log('Backfilling', rseRows.length, 'us-rse rows');
for (let i = 0; i < rseRows.length; i++) {
  const r = await backfillRow(rseRows[i]);
  recordResult('us-rse', r);
}
console.log('  done.');

console.log('\n========== 3) HIMSS — backfill JD ==========');
const himssRows = db.prepare(`SELECT id, url FROM jobs WHERE ats_platform='himss' AND jd_text IS NULL AND removed=0`).all();
console.log('Backfilling', himssRows.length, 'HIMSS rows (Playwright — slow)');
for (let i = 0; i < himssRows.length; i++) {
  const r = await backfillRow(himssRows[i]);
  recordResult('himss', r);
  if ((i + 1) % 5 === 0 || i === himssRows.length - 1) console.log(`  [${i+1}/${himssRows.length}]`, r.ok ? `score=${r.score}% matched=${r.matched} show=${r.show}` : 'failed');
}

await closeBrowser();
db.close();

console.log('\n========== FINAL REPORT ==========');
console.log('Source       | Scraped | JD ok | 1+ skill match | shown');
console.log('-'.repeat(70));
for (const [src, t] of Object.entries(totals)) {
  console.log(`${src.padEnd(13)}|${String(t.attempted).padStart(8)} |${String(t.jd_ok).padStart(6)} |${String(t.matched_ge_1).padStart(15)} |${String(t.shown).padStart(6)}`);
}
