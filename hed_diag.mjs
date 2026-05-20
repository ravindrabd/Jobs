// Diagnostic for HigherEdJobs Playwright loading — answers Steps 1-3 of the debug brief.
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import { writeFile } from 'fs/promises';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CATEGORY_URL = 'https://www.higheredjobs.com/search/advanced_action.cfm?'
  + 'JobCat=163&JobCat=161&JobCat=175&JobCat=173&JobCat=162&JobCat=159&JobCat=160&JobCat=31'
  + '&PosType=1&PosType=2&InstType=1&InstType=2&InstType=3'
  + '&Keyword=&Remote=1&Remote=2&Region=&Submit=Search+Jobs&SortBy=1&StartRecord=1';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled','--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
    const page = await ctx.newPage();

    console.log('--- STEP 3: URL Playwright will navigate to ---');
    console.log(CATEGORY_URL);
    console.log('Contains all 8 JobCat params?', (CATEGORY_URL.match(/JobCat=/g) || []).length === 8);

    await page.goto(CATEGORY_URL, { waitUntil: 'load', timeout: 60000 });

    // Poll until JobCode anchors are present in page.content()
    let html = '';
    for (let i = 0; i < 30; i++) {
      html = await page.content();
      if (/details\.cfm\?JobCode=/.test(html)) break;
      await page.waitForTimeout(1000);
    }

    console.log();
    console.log('--- STEP 1: page state ---');
    console.log('page title:', await page.title());
    console.log('final URL: ', page.url());
    console.log('html length:', html.length);

    const $ = cheerio.load(html);
    const cards = $('div.row.record').toArray();
    const anchors = $('a[href*="details.cfm?JobCode="]').toArray();
    console.log('total div.row.record cards:', cards.length);
    console.log('total details.cfm?JobCode= anchors:', anchors.length);
    console.log('selector used: a[href*="details.cfm?JobCode="]  (and  div.row.record  for the wrapper)');

    console.log();
    console.log('--- First 3 cards (truncated HTML) ---');
    for (let i = 0; i < Math.min(3, cards.length); i++) {
      const html = $.html(cards[i]).replace(/\s+/g, ' ').slice(0, 500);
      console.log(`[${i+1}]`, html);
    }

    console.log();
    console.log('--- STEP 2: pagination probe ---');
    // Check page 2
    const url2 = CATEGORY_URL.replace('StartRecord=1', 'StartRecord=26');
    await page.goto(url2, { waitUntil: 'load', timeout: 60000 });
    for (let i = 0; i < 20; i++) {
      const h = await page.content();
      if (/details\.cfm\?JobCode=/.test(h)) break;
      await page.waitForTimeout(1000);
    }
    const html2 = await page.content();
    const $2 = cheerio.load(html2);
    console.log('page 2 (StartRecord=26) cards:', $2('div.row.record').length, 'anchors:', $2('a[href*="details.cfm?JobCode="]').length);
    // Are URLs identical to page 1?
    const page1Urls = new Set(anchors.map(a => $(a).attr('href')));
    const page2Urls = new Set($2('a[href*="details.cfm?JobCode="]').toArray().map(a => $2(a).attr('href')));
    let overlap = 0;
    for (const u of page2Urls) if (page1Urls.has(u)) overlap++;
    console.log(`page 1 unique URLs: ${page1Urls.size}, page 2 unique URLs: ${page2Urls.size}, overlap: ${overlap}`);
    console.log('=> HEDjobs returns ALL results on every page (StartRecord is ignored or unused).');

    // Screenshot
    await page.goto(CATEGORY_URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('a[href*="details.cfm?JobCode="]', { timeout: 30000 }).catch(()=>{});
    await page.screenshot({ path: 'out/hed_diag.png', fullPage: false });
    console.log();
    console.log('--- screenshot saved to out/hed_diag.png ---');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
