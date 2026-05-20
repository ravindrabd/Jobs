// Unified scraper for the 3-hour cron. Idempotent: only processes URLs not in DB.
// For each NEW URL: insert row, fetch JD, match against MY_SKILLS, set show_flag.
//
// Runs: HEDjobs category, us-rse.org, HIMSS function pages, AHIMA listing page.
// (Direct portals are re-fetched separately via phase2.mjs because they need orgs.csv.)
// (Idealist & ANIA & iCIMS-hospitals omitted — bot-blocked / no usable URL pattern.)

import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { findMatches, isBlockedTitle } = require('./my_skills.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || undefined;

const HEDJOBS_URL = 'https://www.higheredjobs.com/search/advanced_action.cfm?'
  + 'JobCat=163&JobCat=161&JobCat=175&JobCat=173&JobCat=162&JobCat=159&JobCat=160&JobCat=31'
  + '&PosType=1&PosType=2&InstType=1&InstType=2&InstType=3'
  + '&Keyword=&Remote=1&Remote=2&Region=&Submit=Search+Jobs&SortBy=1&StartRecord=1';
const HIMSS_FUNCTIONS = [
  'administrator','cio-vp-of-it-is','clinical-informatics','clinical-information-management',
  'him-management','analyst','programmer','engineer','developer',
  'database-administrator','network-administrator','systems-analyst',
  'software-developer','project-manager-program-manager',
];

const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'jobs.db')
  : (process.env.DB_PATH || path.join(process.cwd(), 'jobs.db'));

function htmlToText(html) {
  return (html || '').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
}
function parsePostedIso(raw) {
  if (!raw) return null; const s = String(raw).trim(); if (!s) return null;
  let d = Date.parse(s); if (!Number.isNaN(d)) return new Date(d).toISOString().slice(0,10);
  if (/posted\s+today/i.test(s)) return new Date().toISOString().slice(0,10);
  if (/posted\s+yesterday/i.test(s)) { const dt=new Date(); dt.setDate(dt.getDate()-1); return dt.toISOString().slice(0,10); }
  let m = s.match(/posted\s+(\d+)\+?\s+days?\s+ago/i);
  if (m) { const dt=new Date(); dt.setDate(dt.getDate()-parseInt(m[1],10)); return dt.toISOString().slice(0,10); }
  d = Date.parse(s.replace(/^posted:?\s*/i,'')); if (!Number.isNaN(d)) return new Date(d).toISOString().slice(0,10);
  return null;
}
function norm(s){return (s||'').toLowerCase().replace(/[^\w\s]/g,'').replace(/\s+/g,' ').trim();}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT)`);

const stmts = {
  exists:    db.prepare('SELECT 1 FROM jobs WHERE url = ?'),
  insert:    db.prepare(`INSERT OR IGNORE INTO jobs
    (title, organization, org_type, location, remote, salary, posted_date, posted_date_iso,
     url, ats_platform, source_domain, scraped_at, competition_level, dedup_key,
     jd_text, jd_fetched_at, matched_skills, missing_skills, match_score, show_flag)
    VALUES (?, ?, ?, ?, 'no', '', ?, ?, ?, ?, ?, datetime('now'), 'low', ?, ?, datetime('now'), ?, ?, ?, ?)`),
  setKV:     db.prepare('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),
};

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROMIUM_PATH,
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-blink-features=AutomationControlled'],
});
const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });

let totalNew = 0, totalShown = 0, totalBlocked = 0;

async function processCandidate({ title, url, organization, org_type, ats_platform, source_domain, location, posted_date }) {
  if (!url || !title) return;
  if (stmts.exists.get(url)) return;            // already in DB → skip
  if (isBlockedTitle(title)) { totalBlocked++; return; }
  // Fetch JD
  let jdText = '';
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html' } });
    if (r.ok) jdText = htmlToText(await r.text()).slice(0, 30000);
  } catch {}
  // Fall back to Playwright for JS-rendered sources (HEDjobs detail is actually server-rendered but be safe)
  if (!jdText || jdText.length < 200) {
    const p = await ctx.newPage();
    try {
      await p.goto(url, { waitUntil: 'load', timeout: 25000 });
      await p.waitForTimeout(2000);
      jdText = htmlToText(await p.content()).slice(0, 30000);
    } catch {} finally { try { await p.close(); } catch {} }
  }
  const m = findMatches(jdText || title);
  const show = m.matched.length >= 1 ? 1 : 0;
  const iso = parsePostedIso(posted_date);
  stmts.insert.run(
    title, organization || '', org_type || 'university', location || '',
    posted_date || '', iso,
    url, ats_platform, source_domain,
    `${norm(title)}|${norm(organization)}|${norm(location)}`,
    jdText, JSON.stringify(m.matched), JSON.stringify(m.missing), m.score, show
  );
  totalNew++;
  if (show) totalShown++;
}

// ---- HEDjobs: category URL only ----
async function scrapeHedjobs() {
  const page = await ctx.newPage();
  try {
    await page.goto(HEDJOBS_URL, { waitUntil: 'load', timeout: 60000 });
    let html = '';
    for (let i=0; i<30; i++) {
      html = await page.content();
      if (/details\.cfm\?JobCode=/.test(html)) break;
      await page.waitForTimeout(1000);
    }
    if (!/details\.cfm\?JobCode=/.test(html)) return 0;
    const $ = cheerio.load(html);
    const before = totalNew;
    for (const a of $('a[href*="details.cfm?JobCode="]').toArray()) {
      const $a = $(a);
      const href = $a.attr('href') || ''; if (!/details\.cfm\?JobCode=/.test(href)) continue;
      const title = $a.text().trim(); if (!title) continue;
      const fullUrl = href.startsWith('http') ? href : `https://www.higheredjobs.com/search/${href.replace(/^\//,'')}`;
      const col7 = $a.closest('div.col-sm-7');
      const col5 = col7.next('div.col-sm-5, div[class*="col-sm-5"]');
      const afterAnchor = (col7.html()||'').replace(/<a[\s\S]*?<\/a>/i, '');
      const pieces = afterAnchor.split(/<br\s*\/?\s*>/i).map(p=>htmlToText(p)).filter(Boolean);
      const nonSalary = pieces.filter(p => !/^\$|salary|usd/i.test(p));
      const institution = nonSalary[0] || '';
      const loc = nonSalary[1] || '';
      const col5Pieces = (col5.html()||'').split(/<br\s*\/?\s*>/i).map(p=>htmlToText(p)).filter(Boolean);
      const dateRe = /^(?:posted\s+)?(today|yesterday|\d+\s+days?\s+ago|[A-Z][a-z]+\s+\d{1,2},?\s+\d{4})$/i;
      let postedDate = col5Pieces.find(p=>dateRe.test(p)) || col5Pieces.find(p=>/^posted\s+/i.test(p)) || '';
      postedDate = postedDate.replace(/^posted\s*/i,'').trim();
      await processCandidate({
        title, url: fullUrl, organization: institution || 'Higher Ed (via HigherEdJobs)',
        org_type: 'university', location: loc,
        posted_date: postedDate ? `Posted ${postedDate}` : '',
        ats_platform: 'higheredjobs', source_domain: 'higheredjobs.com',
      });
    }
    return totalNew - before;
  } finally { try { await page.close(); } catch {} }
}

// ---- us-rse.org ----
async function scrapeUsRse() {
  try {
    const r = await fetch('https://us-rse.org/jobs/', { headers: { 'user-agent': UA } });
    if (!r.ok) return 0;
    const $ = cheerio.load(await r.text());
    const before = totalNew;
    for (const li of $('li').toArray()) {
      const $li = $(li);
      const $a = $li.find('a').first();
      const href = $a.attr('href')||''; const title = $a.text().trim();
      const text = $li.text();
      const pm = text.match(/Posted:?\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i);
      if (!title || !href || !pm) continue;
      await processCandidate({
        title, url: href, organization: 'Research Software Engineer',
        org_type: 'university', location: '', posted_date: 'Posted ' + pm[1],
        ats_platform: 'us-rse', source_domain: 'us-rse.org',
      });
    }
    return totalNew - before;
  } catch { return 0; }
}

// ---- HIMSS JobMine ----
async function scrapeHimss() {
  const page = await ctx.newPage();
  let added = 0;
  try {
    for (const fn of HIMSS_FUNCTIONS) {
      try {
        await page.goto(`https://jobmine.himss.org/jobs/function/${fn}`, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(2500);
        const html = await page.content();
        const $ = cheerio.load(html);
        const seen = new Set();
        for (const a of $('a[href*="/job/"]').toArray()) {
          const href = $(a).attr('href')||'';
          if (!/\/job\/[a-z0-9-]+\/\d+\//.test(href)) continue;
          if (seen.has(href)) continue; seen.add(href);
          const full = href.startsWith('http') ? href : `https://jobmine.himss.org${href}`;
          const title = $(a).text().replace(/\s+/g,' ').trim();
          if (!title) continue;
          const before = totalNew;
          await processCandidate({
            title, url: full, organization: 'Hospital (via HIMSS JobMine)',
            org_type: 'hospital', location: '', posted_date: '',
            ats_platform: 'himss', source_domain: 'jobmine.himss.org',
          });
          if (totalNew > before) added++;
        }
      } catch {}
    }
  } finally { try { await page.close(); } catch {} }
  return added;
}

// ---- AHIMA ----
async function scrapeAhima() {
  const page = await ctx.newPage();
  try {
    await page.goto('https://careerassist.ahima.org/jobs/', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2500);
    const $ = cheerio.load(await page.content());
    const before = totalNew;
    const seen = new Set();
    for (const a of $('a[href*="/job/"]').toArray()) {
      const href = $(a).attr('href')||'';
      if (!/\/job\/[a-z0-9-]+\/\d+\//.test(href)) continue;
      if (seen.has(href)) continue; seen.add(href);
      const title = $(a).text().replace(/\s+/g,' ').trim();
      if (!title) continue;
      await processCandidate({
        title, url: 'https://careerassist.ahima.org'+href,
        organization: 'Healthcare (via AHIMA Career Center)',
        org_type: 'hospital', location: '', posted_date: '',
        ats_platform: 'ahima', source_domain: 'careerassist.ahima.org',
      });
    }
    return totalNew - before;
  } catch { return 0; }
  finally { try { await page.close(); } catch {} }
}

// ---- run ----
const t0 = Date.now();
const counts = {};
counts.hedjobs = await scrapeHedjobs();
counts.usrse   = await scrapeUsRse();
counts.himss   = await scrapeHimss();
counts.ahima   = await scrapeAhima();

await browser.close();

const ts = new Date().toISOString();
stmts.setKV.run('last_scrape_at', ts);
stmts.setKV.run('last_scrape_summary', JSON.stringify({
  ...counts, total_new: totalNew, shown: totalShown, blocked: totalBlocked,
  elapsed_s: ((Date.now()-t0)/1000).toFixed(1)
}));

console.log(`[cron-scrape ${ts}] new=${totalNew} shown=${totalShown} blocked=${totalBlocked}  ` +
            `hedjobs=${counts.hedjobs} us-rse=${counts.usrse} himss=${counts.himss} ahima=${counts.ahima}  ` +
            `elapsed=${((Date.now()-t0)/1000).toFixed(1)}s`);
db.close();
