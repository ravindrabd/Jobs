// Fix 3: Fetch JD text for the 236 Direct-portal jobs that have no jd_text yet.
// Most are Workday SPA pages — Playwright needed.
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { findMatches, isBlockedTitle } = require('./my_skills.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function htmlToText(html) {
  return (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

const db = new DatabaseSync('jobs.db');
db.exec('PRAGMA journal_mode = WAL');

// Only jobs that have NO jd_text yet. Skip blocked titles.
const rows = db.prepare(`SELECT id, title, url FROM jobs WHERE removed=0 AND jd_text IS NULL`).all();
console.log('Direct-portal jobs needing JD fetch:', rows.length);

const upd = db.prepare(`UPDATE jobs SET jd_text=?, jd_fetched_at=datetime('now'),
  matched_skills=?, missing_skills=?, match_score=?, show_flag=? WHERE id=?`);

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled','--no-sandbox'] });
try {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });

  let done = 0, ok = 0, fail = 0, shown = 0, hidden = 0, blockedTitle = 0;
  for (const r of rows) {
    done++;
    if (isBlockedTitle(r.title)) { blockedTitle++; hidden++; continue; }
    const page = await ctx.newPage();
    try {
      await page.goto(r.url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(2500);
      const html = await page.content();
      const text = htmlToText(html).slice(0, 30000);
      if (text.length < 100) { fail++; }
      else {
        const m = findMatches(text);
        const show = m.matched.length >= 1 ? 1 : 0;
        upd.run(text, JSON.stringify(m.matched), JSON.stringify(m.missing), m.score, show, r.id);
        ok++;
        if (show) shown++; else hidden++;
      }
    } catch { fail++; }
    finally { try { await page.close(); } catch {} }
    if (done % 25 === 0 || done === rows.length) {
      console.log(`[${done}/${rows.length}] ok=${ok} fail=${fail} blocked_title=${blockedTitle} shown=${shown}`);
    }
  }

  console.log('\n========== FINAL ==========');
  console.log('attempted:', rows.length);
  console.log('JD ok:    ', ok);
  console.log('failed:   ', fail);
  console.log('blocked:  ', blockedTitle);
  console.log('shown:    ', shown);
  console.log('hidden:   ', hidden);
} finally { await browser.close(); db.close(); }
