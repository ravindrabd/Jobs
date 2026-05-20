// Supplemental HEDjobs scrape — only the 10 keywords my prior run missed.
// Uses the same Playwright + cheerio approach as phase2b_aggregators.mjs.
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { writeFile, appendFile, readFile } from 'fs/promises';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const NEW_KEYWORDS = [
  'engineer', 'data', 'systems', 'analyst', 'mobile',
  'epic', 'cerner', 'HL7', 'FHIR', 'informatics',
];

function csvEsc(s) { if (s == null) return ''; s = String(s); return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

async function scrapeOne(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  let html = '';
  for (let i = 0; i < 30; i++) {
    html = await page.content();
    if (/details\.cfm\?JobCode=/.test(html)) break;
    await page.waitForTimeout(1000);
  }
  if (!/details\.cfm\?JobCode=/.test(html)) return [];
  const $ = cheerio.load(html);
  const out = [];
  const clean = (s) => $('<div>').html(s || '').text().replace(/\s+/g, ' ').trim();
  for (const a of $('a[href*="details.cfm?JobCode="]').toArray()) {
    const $a = $(a);
    const href = $a.attr('href') || '';
    const title = $a.text().trim();
    if (!title) continue;
    const fullUrl = href.startsWith('http') ? href : `https://www.higheredjobs.com/search/${href.replace(/^\//, '')}`;
    const col7 = $a.closest('div.col-sm-7');
    const col5 = col7.next('div.col-sm-5, div[class*="col-sm-5"]');
    const col7Html = col7.html() || '';
    const afterAnchor = col7Html.replace(/<a[\s\S]*?<\/a>/i, '');
    const pieces = afterAnchor.split(/<br\s*\/?\s*>/i).map(clean).filter(Boolean);
    const nonSalary = pieces.filter(p => !/^\$|salary|usd/i.test(p));
    const institution = nonSalary[0] || '';
    const location    = nonSalary[1] || '';
    const col5Pieces = (col5.html() || '').split(/<br\s*\/?\s*>/i).map(clean).filter(Boolean);
    const dateRe = /^(?:posted\s+)?(today|yesterday|\d+\s+days?\s+ago|\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})$/i;
    let postedDate = col5Pieces.find(p => dateRe.test(p)) || col5Pieces.find(p => /^posted\s+/i.test(p)) || '';
    postedDate = postedDate.replace(/^posted\s*/i, '').trim();
    out.push({
      title, organization: institution || 'Higher Ed (via HigherEdJobs)',
      org_type: 'university', location,
      posted_date: postedDate ? `Posted ${postedDate}` : '',
      url: fullUrl,
      ats_platform: 'higheredjobs', source_domain: 'higheredjobs.com',
    });
  }
  return out;
}

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled','--no-sandbox'] });
try {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  const page = await ctx.newPage();

  // Read existing aggregator URLs so we don't re-emit dups
  let existingUrls = new Set();
  try {
    const t = await readFile('jobs_aggregators.csv', 'utf8');
    for (const line of t.split(/\r?\n/).slice(1)) {
      const m = line.match(/(https?:\/\/[^",]+)/);
      if (m) existingUrls.add(m[1]);
    }
  } catch {}
  console.log('Existing URLs in jobs_aggregators.csv:', existingUrls.size);

  const perKwCounts = {};
  let newRowsWritten = 0;
  let allFoundThisRun = new Set();

  for (let i = 0; i < NEW_KEYWORDS.length; i++) {
    const kw = NEW_KEYWORDS[i];
    const url = `https://www.higheredjobs.com/search/advanced_action.cfm?Keyword=${encodeURIComponent(kw)}&SortBy=1&StartRecord=1`;
    let results = [];
    try { results = await scrapeOne(page, url); }
    catch (e) { console.error(`  ${kw} ERR:`, e.message); }
    let newOnes = 0;
    for (const r of results) {
      if (existingUrls.has(r.url) || allFoundThisRun.has(r.url)) continue;
      allFoundThisRun.add(r.url);
      const row = [r.title, r.organization, r.org_type, r.location, 'no', '',
                   r.posted_date, r.url, r.ats_platform, r.source_domain, new Date().toISOString()]
                   .map(csvEsc).join(',');
      await appendFile('jobs_aggregators.csv', row + '\n');
      newOnes++; newRowsWritten++;
    }
    perKwCounts[kw] = { raw: results.length, new: newOnes };
    console.log(`  [${i+1}/${NEW_KEYWORDS.length}] ${kw.padEnd(14)} → ${results.length} raw, ${newOnes} new (cumulative new: ${newRowsWritten})`);
    await page.waitForTimeout(600);
  }

  console.log('\n--- per-keyword summary ---');
  for (const [kw, v] of Object.entries(perKwCounts)) console.log(`  ${kw.padEnd(14)} raw=${v.raw}  new=${v.new}`);
  console.log(`\nGrand total NEW URLs this run: ${newRowsWritten}`);
} finally {
  await browser.close();
}
