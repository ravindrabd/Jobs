// Fix 5: re-probe each iCIMS-tagged hospital's actual careers page (via Playwright,
// to handle JS redirects/iframes), find the CURRENT iCIMS host, then scrape jobs.

import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, appendFile } from 'fs/promises';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { findMatches, isBlockedTitle } = require('./my_skills.js');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function parseCsv(p) {
  return readFile(p, 'utf8').then(text => {
    const lines = text.split(/\r?\n/).filter(Boolean);
    const h = lines[0].split(',');
    return lines.slice(1).map(line => {
      const c = []; let cur = '', inQ = false;
      for (let k = 0; k < line.length; k++) {
        const x = line[k];
        if (inQ) { if (x === '"' && line[k+1] === '"') { cur += '"'; k++; } else if (x === '"') inQ = false; else cur += x; }
        else { if (x === ',') { c.push(cur); cur = ''; } else if (x === '"') inQ = true; else cur += x; }
      }
      c.push(cur);
      const r = {}; h.forEach((x, i) => r[x] = c[i] || ''); return r;
    });
  });
}

const hospitals = await parseCsv('out/hospitals_with_ats.csv');
const icimsRows = hospitals.filter(h => h.ats_detected === 'true' && h.ats_platform === 'icims' && h.careers_url);
console.log('iCIMS hospitals to re-probe:', icimsRows.length);

function htmlToText(html) {
  return (html || '').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled','--no-sandbox'] });
const db = new DatabaseSync('jobs.db');
db.exec('PRAGMA journal_mode = WAL');

const insert = db.prepare(`INSERT OR IGNORE INTO jobs
  (title, organization, org_type, location, remote, salary, posted_date, posted_date_iso,
   url, ats_platform, source_domain, scraped_at, competition_level, dedup_key,
   jd_text, jd_fetched_at, matched_skills, missing_skills, match_score, show_flag)
  VALUES (?, ?, 'hospital', ?, 'no', '', '', NULL, ?, 'icims', ?, datetime('now'), 'low', ?, ?, datetime('now'), ?, ?, ?, ?)`);

function norm(s) { return (s || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(); }

try {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });

  let probed = 0, livHosts = 0, jobsFound = 0, jobsInserted = 0, shown = 0;
  const liveTenants = new Set();

  for (const h of icimsRows) {
    probed++;
    const page = await ctx.newPage();
    let icimsHost = null;
    try {
      await page.goto(h.careers_url, { waitUntil: 'load', timeout: 25000 });
      await page.waitForTimeout(2500);
      const html = await page.content();
      // Find any iCIMS host mentioned anywhere on the page (iframe src, links, JS strings)
      const m = html.match(/(careers-[a-z0-9_-]+\.icims\.com|[a-z0-9_-]+\.icims\.com)/i);
      if (m) icimsHost = m[1].toLowerCase();
    } catch { /* skip on timeout */ }
    finally { try { await page.close(); } catch {} }

    if (!icimsHost) {
      if (probed % 20 === 0) console.log(`[${probed}/${icimsRows.length}] no host found`);
      continue;
    }
    if (liveTenants.has(icimsHost)) continue;
    liveTenants.add(icimsHost);
    livHosts++;

    // Try to scrape this iCIMS tenant. Probe with empty searchKeyword.
    const searchUrl = `https://${icimsHost}/jobs/search?ss=1&searchKeyword=&startIndex=0`;
    const sp = await ctx.newPage();
    let listHtml = '';
    try {
      await sp.goto(searchUrl, { waitUntil: 'load', timeout: 25000 });
      await sp.waitForTimeout(2500);
      listHtml = await sp.content();
    } catch { /* skip */ }
    finally { try { await sp.close(); } catch {} }
    if (!listHtml) continue;

    const $ = cheerio.load(listHtml);
    const anchors = $('a[href*="/jobs/"]').toArray()
      .map(a => $(a).attr('href') || '')
      .filter(href => /\/jobs\/\d+/.test(href));
    const uniq = Array.from(new Set(anchors));
    for (const href of uniq) {
      const $a = $(`a[href="${href}"]`).first();
      const title = $a.text().replace(/\s+/g, ' ').trim();
      if (!title || title.length < 4) continue;
      if (isBlockedTitle(title)) continue;
      const fullUrl = href.startsWith('http') ? href : `https://${icimsHost}${href}`;
      jobsFound++;
      // Title-only match (skip JD fetch to keep total time bounded)
      const m = findMatches(title);
      const show = m.matched.length >= 1 ? 1 : 0;
      try {
        const info = insert.run(title, h.name || 'Hospital', '', fullUrl, 'icims.com',
                                norm(title) + '|' + norm(h.name) + '|', '',
                                JSON.stringify(m.matched), JSON.stringify(m.missing), m.score, show);
        if (info.changes) {
          jobsInserted++;
          if (show) shown++;
        }
      } catch {}
    }
    if (probed % 10 === 0) console.log(`[${probed}/${icimsRows.length}] live=${livHosts} jobs_found=${jobsFound} inserted=${jobsInserted} shown=${shown}`);
  }

  console.log('\n========== FINAL ==========');
  console.log('iCIMS hospitals probed:', probed);
  console.log('Live iCIMS tenants found:', livHosts);
  console.log('Jobs found:', jobsFound);
  console.log('Jobs inserted (URL-unique):', jobsInserted);
  console.log('Shown (≥1 skill match in title):', shown);
} finally { await browser.close(); db.close(); }
