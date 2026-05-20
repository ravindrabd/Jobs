// HIMSS JobMine scraper — needs Playwright (Cloudflare 403s a plain curl).
// Sweep all healthcare-IT function categories, dedup by URL, tag as hospital/himss.
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { appendFile, writeFile } from 'fs/promises';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// HIMSS function slugs discovered from /jobmine.himss.org root
const FUNCTIONS = [
  'administrator', 'cio-vp-of-it-is', 'clinical-informatics',
  'clinical-information-management', 'coder-medical-coder', 'consultant',
  'him-management', 'healthcare', 'general-management',
  'analyst', 'programmer', 'engineer', 'developer',
  'database-administrator', 'network-administrator', 'systems-analyst',
  'software-developer', 'project-manager-program-manager',
];

function csvEsc(s) { if (s == null) return ''; s = String(s); return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled','--no-sandbox'] });
try {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  const page = await ctx.newPage();

  const seenUrls = new Set();
  const all = [];
  for (let i = 0; i < FUNCTIONS.length; i++) {
    const fn = FUNCTIONS[i];
    const url = `https://jobmine.himss.org/jobs/function/${fn}`;
    try { await page.goto(url, { waitUntil: 'load', timeout: 30000 }); }
    catch (e) { console.error(`  ${fn} goto: ${e.message}`); continue; }
    await page.waitForTimeout(3500);
    const html = await page.content();
    const $ = cheerio.load(html);
    const anchors = [...new Set($('a[href*="/job/"]').toArray().map(a => $(a).attr('href')).filter(h => /\/job\/[a-z0-9-]+\/\d+\//.test(h || '')))];
    let added = 0;
    for (const href of anchors) {
      const full = href.startsWith('http') ? href : 'https://jobmine.himss.org' + href;
      if (seenUrls.has(full)) continue;
      seenUrls.add(full);
      // Title: find anchor with this href and read its text
      const $a = $('a[href="' + href + '"]').first();
      const title = $a.text().replace(/\s+/g, ' ').trim() || href.split('/').filter(Boolean).slice(-2, -1)[0].replace(/-/g, ' ');
      // Try to pull organization from nearby ".profile/" link in the card
      const card = $a.closest('div, article, li');
      const orgLink = card.find('a[href*="/profile/"]').first();
      const org = orgLink.text().trim();
      const cardText = card.text().replace(/\s+/g, ' ').trim();
      const locMatch = cardText.match(/([A-Z][A-Za-z .'&-]+,\s*[A-Z]{2}|Remote|Hybrid)/);
      const dateMatch = cardText.match(/Posted[:\s]+([A-Za-z]+ \d{1,2},\s*\d{4}|\d+\s+days?\s+ago|Yesterday|Today)/i);
      all.push({
        title,
        organization: org || 'Hospital (via HIMSS JobMine)',
        org_type: 'hospital',
        location: locMatch ? locMatch[1] : '',
        salary: '',
        posted_date: dateMatch ? `Posted ${dateMatch[1]}` : '',
        url: full,
        ats_platform: 'himss',
        source_domain: 'jobmine.himss.org',
      });
      added++;
    }
    console.log(`  [${i+1}/${FUNCTIONS.length}] ${fn.padEnd(35)} → ${anchors.length} anchors, ${added} new (total ${all.length})`);
  }

  const header = 'title,organization,org_type,location,remote,salary,posted_date,url,ats_platform,source_domain,scraped_at';
  await writeFile('jobs_himss.csv', header + '\n');
  const now = new Date().toISOString();
  for (const r of all) {
    const row = [r.title, r.organization, r.org_type, r.location, 'no', r.salary, r.posted_date, r.url, r.ats_platform, r.source_domain, now].map(csvEsc).join(',');
    await appendFile('jobs_himss.csv', row + '\n');
  }
  console.log(`\nWrote ${all.length} HIMSS jobs to jobs_himss.csv`);
} finally {
  await browser.close();
}
