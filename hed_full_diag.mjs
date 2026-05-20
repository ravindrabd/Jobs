// User-requested diagnostic: intercept network, test selectors, dump HTML.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
});
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 900 },
});
await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
const page = await ctx.newPage();

const apiCalls = [];
page.on('request', req => {
  const url = req.url();
  if (/search|api|jobs|cfm/i.test(url)) apiCalls.push(req.method() + ' ' + url);
});

await page.goto('https://www.higheredjobs.com/search/advanced_action.cfm?Keyword=software&SortBy=1', { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(5000);

console.log('--- API CALLS INTERCEPTED ---');
for (const u of apiCalls) console.log('  ' + u);
console.log('total intercepted:', apiCalls.length);

console.log();
console.log('--- SELECTOR TESTS ---');
const selectors = [
  'a[href*="JobCode"]',
  'a[href*="details.cfm?JobCode="]',
  '.job-result',
  '.search-result',
  'tr.result-row',
  'div.record',
  'div.row.record',
  '.job-listing',
  'table.tbl-results tr',
  '#search-results a',
  '.jobTitle',
  'a.jobtitle',
];
for (const sel of selectors) {
  const count = await page.$$eval(sel, els => els.length).catch(() => 0);
  console.log(`  ${sel.padEnd(40)} → ${count}`);
}

console.log();
const html = await page.content();
const bodyIdx = html.indexOf('<body');
console.log('--- HTML SNIPPET (first 3000 chars from <body>) ---');
console.log(html.substring(bodyIdx, bodyIdx + 3000));

await browser.close();
