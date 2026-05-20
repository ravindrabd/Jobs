// Bulk JD-text backfill for all HEDjobs rows missing jd_text.
// Detail pages are server-rendered → plain HTTP fetch is enough (no Playwright per page).
// Concurrency 25, ~50ms per fetch best case; expect ~5–15 min for 40k rows.

import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { matchAgainstJd } = require('./jd_fetch.js');

process.setMaxListeners(0);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function htmlToText(html) {
  return (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchOne(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal, redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
  finally { clearTimeout(t); }
}

function pLimit(n) {
  let active = 0, queue = [];
  const next = () => {
    while (active < n && queue.length) {
      const { fn, resolve, reject } = queue.shift();
      active++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
    }
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

const db = new DatabaseSync('jobs.db');
db.exec('PRAGMA journal_mode = WAL');

const resumeRow = db.prepare('SELECT resume_parsed FROM resume WHERE id = 1').get();
if (!resumeRow) { console.error('No resume loaded — upload one first.'); process.exit(1); }
const resume = JSON.parse(resumeRow.resume_parsed);
console.log('Resume:', resume.skills.length, 'skills loaded');

const rows = db.prepare(`SELECT id, url FROM jobs WHERE ats_platform='higheredjobs' AND removed=0 AND jd_text IS NULL`).all();
console.log('HEDjobs rows to backfill:', rows.length);

const upd = db.prepare(`UPDATE jobs SET jd_text=?, jd_fetched_at=datetime('now'),
  matched_skills=?, missing_skills=?, match_score=?, show_flag=? WHERE id=?`);

const limit = pLimit(25);
let done = 0, ok = 0, fail = 0, matched1 = 0, shown = 0, hidden = 0;
const t0 = Date.now();

const tasks = rows.map(r => limit(async () => {
  const html = await fetchOne(r.url);
  done++;
  if (!html) { fail++; }
  else {
    const text = htmlToText(html).slice(0, 30000);
    const m = matchAgainstJd(text, resume);
    const show = m.matched_skills.length >= 1 ? 1 : 0;
    try {
      upd.run(text, JSON.stringify(m.matched_skills), JSON.stringify(m.missing_skills), m.score, show, r.id);
      ok++;
      if (m.matched_skills.length >= 1) matched1++;
      if (show) shown++; else hidden++;
    } catch (e) { fail++; }
  }
  if (done % 500 === 0 || done === rows.length) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    const rate = (done / Math.max(1, elapsed / 60)).toFixed(0);
    console.log(`[${done}/${rows.length}] ok=${ok} fail=${fail} 1+match=${matched1} shown=${shown}  (${elapsed}s, ~${rate}/min)`);
  }
}));

await Promise.all(tasks);

console.log('\n========== FINAL ==========');
console.log('HEDjobs total rows checked:    ', rows.length);
console.log('JD fetched successfully:        ', ok);
console.log('JD fetch failed:                ', fail);
console.log('1+ skill match (show=true):     ', matched1);
console.log('0 skill match (show=false):     ', ok - matched1);
console.log('Total elapsed:                  ', ((Date.now() - t0) / 1000).toFixed(0), 's');
db.close();
