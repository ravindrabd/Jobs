// Phase 2b: Scrape software jobs from full-text aggregator sites.
// Output: jobs_aggregators.csv (same schema as jobs.csv)
//
// Sites:
//   - HigherEdJobs   (HTML scrape, university roles)
//   - Chronicle      (jobs.chronicle.com — HTML scrape, university roles)
//   - Idealist       (tries JSON-ish API, falls back to HTML; nonprofit roles)
//
// Each site is queried for every search term in AGGREGATOR_SEARCH_QUERIES,
// then the same KEYWORDS substring filter is applied to ensure software-only.

import { writeFile, appendFile } from 'fs/promises';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

process.setMaxListeners(0);

const AGGREGATOR_SEARCH_QUERIES = [
  'software engineer', 'developer', 'data engineer', 'devops',
  'machine learning', 'cloud engineer', 'security engineer',
  'web developer', 'mobile developer', 'systems administrator',
  'research software', 'GIS developer', 'bioinformatics',
];

const KEYWORDS = [
  'software engineer', 'software developer', 'software programmer',
  'application engineer', 'application developer', 'systems engineer',
  'systems developer', 'systems programmer', 'computer scientist',
  'research engineer', 'research software', 'scientific programmer',
  'computational scientist', 'research computing',
  'frontend', 'front-end', 'front end', 'ui engineer', 'ui developer',
  'ux engineer', 'web developer', 'web engineer', 'web programmer',
  'javascript developer', 'react developer', 'angular developer',
  'vue developer', 'typescript developer', 'html developer',
  'backend', 'back-end', 'back end', 'api developer', 'api engineer',
  'python developer', 'java developer', 'golang developer', 'go developer',
  'ruby developer', 'php developer', 'scala developer', 'rust developer',
  'c++ developer', 'c# developer', '.net developer', 'node developer',
  'django developer', 'rails developer', 'spring developer',
  'full stack', 'fullstack', 'full-stack',
  'mobile developer', 'mobile engineer', 'ios developer', 'ios engineer',
  'android developer', 'android engineer', 'react native', 'flutter developer',
  'swift developer', 'kotlin developer',
  'data engineer', 'data developer', 'data architect', 'data analyst',
  'data scientist', 'analytics engineer', 'business intelligence',
  'bi developer', 'bi engineer', 'etl developer', 'etl engineer',
  'pipeline engineer', 'database developer', 'database engineer',
  'database administrator', 'dba', 'sql developer', 'nosql developer',
  'spark developer', 'hadoop developer', 'kafka engineer',
  'machine learning', 'ml engineer', 'ml developer', 'ai engineer',
  'ai developer', 'deep learning', 'nlp engineer', 'computer vision',
  'data science', 'llm engineer', 'generative ai', 'prompt engineer',
  'applied scientist', 'research scientist',
  'cloud engineer', 'cloud developer', 'cloud architect',
  'infrastructure engineer', 'infrastructure developer',
  'platform engineer', 'platform developer', 'devops', 'dev ops',
  'site reliability', 'sre', 'devsecops', 'release engineer',
  'build engineer', 'ci/cd', 'kubernetes engineer', 'aws engineer',
  'azure engineer', 'gcp engineer',
  'security engineer', 'security developer', 'cybersecurity engineer',
  'appsec engineer', 'application security', 'penetration tester',
  'security analyst', 'information security', 'infosec',
  'qa engineer', 'qa developer', 'quality engineer', 'test engineer',
  'automation engineer', 'sdet', 'software tester',
  'solutions architect', 'software architect', 'enterprise architect',
  'technical architect', 'tech lead', 'technical lead', 'staff engineer',
  'principal engineer', 'distinguished engineer', 'engineering manager',
  'director of engineering', 'vp engineering', 'vp of engineering',
  'cto', 'chief technology', 'head of engineering',
  'systems administrator', 'sysadmin', 'it engineer', 'it developer',
  'network engineer', 'network developer', 'it analyst',
  'enterprise systems', 'erp developer', 'salesforce developer',
  'sharepoint developer', 'it architect', 'it manager',
  'application administrator', 'technology analyst',
  'information systems', 'information technology developer',
  'gis developer', 'gis analyst', 'geospatial developer',
  'bioinformatics', 'cheminformatics', 'computational biologist',
  'research programmer', 'scientific software',
  'blockchain developer', 'web3 developer', 'smart contract',
  'embedded developer', 'embedded engineer', 'firmware engineer',
  'iot developer', 'robotics engineer',
];
const KW_LOWER = KEYWORDS.map(k => k.toLowerCase());
function titleMatches(title) {
  if (!title) return false;
  const t = title.toLowerCase();
  return KW_LOWER.some(k => t.includes(k));
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchHtml(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': UA,
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    if (!r.ok) return { ok: false, status: r.status, body: '' };
    return { ok: true, status: r.status, body: await r.text(), finalUrl: r.url };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: e?.message };
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        'user-agent': UA,
        'accept': 'application/json,*/*',
        'accept-language': 'en-US,en;q=0.9',
        ...(opts.headers || {}),
      },
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) return null;
    return await r.json();
  } catch { return null; }
  finally { clearTimeout(t); }
}

function decodeHtml(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ').trim();
}

function stripTags(s) { return (s || '').replace(/<[^>]+>/g, ''); }

// ---- HigherEdJobs ----
// Single category-filtered URL: IT Management (163), Programming/Systems (161),
// Database (175), Networking (173), Web Development (162), Software Engineer (159),
// Systems Admin (160), Computer/Tech (31). Pagination: &StartRecord=1, 26, 51, …
//
// NOTE on rendering: the search page is JS-rendered (loads /assets/hej/scripts/
// searchresults.js client-side). A raw HTTP fetch returns the page shell with zero
// job markup. This extractor is correct for both the markup spec AND for whenever
// HEDjobs is hit via a headless browser; today it will return 0 from raw fetches.
// 20 additional keyword searches per the debug brief.
const HEDJOBS_KEYWORDS = [
  'software', 'developer', 'programmer', 'data engineer', 'systems analyst',
  'devops', 'cloud engineer', 'application developer', 'web developer',
  'database administrator', 'IT analyst', 'network engineer', 'security engineer',
  'machine learning', 'banner developer', 'ERP analyst', 'research software',
  'GIS', 'bioinformatics', 'HPC',
];

async function scrapeHigherEdJobs(_unusedQueryParam) {
  const CAT = 'https://www.higheredjobs.com/search/advanced_action.cfm?'
            + 'JobCat=163&JobCat=161&JobCat=175&JobCat=173&JobCat=162&JobCat=159&JobCat=160&JobCat=31'
            + '&PosType=1&PosType=2&InstType=1&InstType=2&InstType=3'
            + '&Keyword=&Remote=1&Remote=2&Region=&Submit=Search+Jobs&SortBy=1&StartRecord=1';
  // Each keyword search URL — single page each (HEDjobs renders all results in one page).
  const KEYWORD_URLS = HEDJOBS_KEYWORDS.map(k =>
    `https://www.higheredjobs.com/search/advanced_action.cfm?Keyword=${encodeURIComponent(k)}&SortBy=1&StartRecord=1`
  );
  const allUrls = [CAT, ...KEYWORD_URLS];

  const found = [];
  const seenUrls = new Set();

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  try {
    const ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1366, height: 900 },
    });
    await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
    const page = await ctx.newPage();
    let urlIdx = 0;

    for (const url of allUrls) {
      urlIdx++;
      const label = url === CAT ? 'category' : url.match(/Keyword=([^&]+)/)?.[1] || '?';
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      } catch (e) {
        console.error(`  HEDjobs goto failed [${label}]: ${e.message}`);
        continue;
      }
      // Playwright locators on this page miss the anchors (Page DOM quirk), but
      // page.content() returns the fully-rendered HTML with all listings.
      let html = '';
      for (let attempt = 0; attempt < 30; attempt++) {
        html = await page.content();
        if (/details\.cfm\?JobCode=/.test(html)) break;
        await page.waitForTimeout(1000);
      }
      if (!/details\.cfm\?JobCode=/.test(html)) {
        console.log(`  HEDjobs [${label}]: 0 results (search returned nothing)`);
        continue;
      }
      const $ = cheerio.load(html);
      const anchors = $('a[href*="details.cfm?JobCode="]').toArray();
      let foundOnPage = 0, newOnPage = 0;
      // Helper: strip tags + collapse whitespace
      const clean = (s) => $('<div>').html(s || '').text().replace(/\s+/g, ' ').trim();
      for (const a of anchors) {
        const $a = $(a);
        const href = $a.attr('href') || '';
        if (!/details\.cfm\?JobCode=/.test(href)) continue;
        const title = $a.text().trim();
        if (!title) continue;
        const fullUrl = href.startsWith('http')
          ? href
          : `https://www.higheredjobs.com/search/${href.replace(/^\//, '')}`;
        foundOnPage++;
        if (seenUrls.has(fullUrl)) continue;
        seenUrls.add(fullUrl);

        // Row structure: <div class="row record">
        //   <div class="col-sm-7"> <a>TITLE</a><br> INSTITUTION <br> LOCATION <br> ...salary
        //   <div class="col-sm-5"> CATEGORY<br> POSTED_DATE<br> ...
        const col7 = $a.closest('div.col-sm-7');
        const col5 = col7.next('div.col-sm-5, div[class*="col-sm-5"]');
        const col7Html = col7.html() || '';
        // Strip the title anchor itself, then split on <br> to expose institution / location.
        const afterAnchor = col7Html.replace(/<a[\s\S]*?<\/a>/i, '');
        const pieces = afterAnchor.split(/<br\s*\/?\s*>/i).map(clean).filter(Boolean);
        // Strip the job-salary span if it's in the line (the line will contain "$" or "Salary")
        const nonSalary = pieces.filter(p => !/^\$|salary|usd/i.test(p));
        const institution = nonSalary[0] || '';
        const location    = nonSalary[1] || '';

        const col5Html = col5.html() || '';
        const col5Pieces = col5Html.split(/<br\s*\/?\s*>/i).map(clean).filter(Boolean);
        // Scan for a piece that LOOKS like a posted-date, not a category.
        // Accept: "Posted today/yesterday/N days ago", "Today", "Yesterday",
        // "M/D/YYYY", "Mon DD, YYYY", "MM/DD/YY", or "Posted Mon DD, YYYY".
        const dateRe = /^(?:posted\s+)?(today|yesterday|\d+\s+days?\s+ago|\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})$/i;
        let postedDate = (col5Pieces.find(p => dateRe.test(p)) || '');
        // Fallback: any piece starting with "Posted " is probably the date.
        if (!postedDate) postedDate = col5Pieces.find(p => /^posted\s+/i.test(p)) || '';
        postedDate = postedDate.replace(/^posted\s*/i, '').trim();

        found.push({
          title,
          organization: institution || 'Higher Ed (via HigherEdJobs)',
          org_type: 'university',
          location,
          posted_date: postedDate ? `Posted ${postedDate}` : '',
          url: fullUrl,
          ats_platform: 'higheredjobs',
          source_domain: 'higheredjobs.com',
        });
        newOnPage++;
      }
      console.log(`  HEDjobs [${label}] (${urlIdx}/${allUrls.length}): ${foundOnPage} anchors, ${newOnPage} new (total ${found.length})`);
      await page.waitForTimeout(600);
    }
  } finally {
    await browser.close();
  }
  return found;
}

// ---- us-rse.org (Research Software Engineers) ----
// Static HTML page. <li><a href="JOB_URL">Title</a>: Org, Location&emsp;<em>Posted: Mon DD, YYYY</em></li>
async function scrapeUsRse(_unused) {
  const r = await fetchHtml('https://us-rse.org/jobs/');
  if (!r.ok || !r.body) return [];
  const $ = cheerio.load(r.body);
  const out = [];
  $('li').each((_, li) => {
    const $li = $(li);
    const $a = $li.find('a').first();
    const href = $a.attr('href') || '';
    const title = $a.text().trim();
    if (!title || !href) return;
    const text = $li.text();
    const postedM = text.match(/Posted:?\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i);
    if (!postedM) return; // skip the trailing "external job boards" links
    // After the anchor + ":" prefix we have "Org Name, ..., City, ST  Posted: ..."
    const afterAnchor = text.slice(text.indexOf(title) + title.length).replace(/^\s*:?\s*/, '');
    const orgLoc = afterAnchor.replace(/Posted:?\s*[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}.*$/i, '').trim();
    // Heuristic: last 2 comma-separated tokens are "City, ST"; everything before is organization.
    let organization = orgLoc, location = '';
    const parts = orgLoc.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      // If last token is a 2-letter state (with optional trailing "(modifier)"), pair with prior token.
      const last = parts[parts.length - 1];
      if (/^[A-Z]{2}(\s*\(.+\))?$/.test(last)) {
        location = parts.slice(-2).join(', ');
        organization = parts.slice(0, -2).join(', ');
      } else {
        location = last;
        organization = parts.slice(0, -1).join(', ');
      }
    }
    out.push({
      title,
      organization: organization || 'us-rse.org listed',
      org_type: 'university',
      location,
      posted_date: postedM[1],
      url: href,
      ats_platform: 'us-rse',
      source_domain: 'us-rse.org',
    });
  });
  return out;
}

// ---- Chronicle of Higher Education ----
// Search URL: https://jobs.chronicle.com/searchjobs/?Keywords=<q>&Page=<n>
async function scrapeChronicle(query) {
  const found = [];
  for (let page = 1; page <= 3; page++) {
    const url = `https://jobs.chronicle.com/searchjobs/?Keywords=${encodeURIComponent(query)}&Page=${page}`;
    const r = await fetchHtml(url);
    if (!r.ok || !r.body) break;
    const html = r.body;
    // Listings are typically <h3><a href="/job/NNN/title-slug/"...>Title</a></h3>
    // and sibling .lister__meta-item--recruiter (org) + --location.
    const cardRe = /<li[^>]+class="[^"]*lister__item[^"]*"[\s\S]*?<\/li>/g;
    const cards = html.match(cardRe) || [];
    if (cards.length === 0) {
      // Fallback: simpler title+href anchor scan
      const simpleRe = /<a[^>]+href="(\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      let m, count = 0;
      while ((m = simpleRe.exec(html)) !== null) {
        const title = decodeHtml(stripTags(m[2]));
        if (!title || title.length < 4) continue;
        found.push({
          title,
          organization: 'Higher Ed (via Chronicle)',
          org_type: 'university',
          location: '',
          posted_date: '',
          url: `https://jobs.chronicle.com${m[1]}`,
          ats_platform: 'chronicle',
          source_domain: 'jobs.chronicle.com',
        });
        count++;
      }
      if (count === 0) break;
    } else {
      let foundOnPage = 0;
      for (const card of cards) {
        const titleM = card.match(/<a[^>]+href="(\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!titleM) continue;
        const title = decodeHtml(stripTags(titleM[2]));
        const orgM = card.match(/class="[^"]*lister__meta-item--recruiter[^"]*"[^>]*>([\s\S]*?)<\//);
        const locM = card.match(/class="[^"]*lister__meta-item--location[^"]*"[^>]*>([\s\S]*?)<\//);
        const dateM = card.match(/class="[^"]*lister__meta-item--posted[^"]*"[^>]*>([\s\S]*?)<\//);
        found.push({
          title,
          organization: orgM ? decodeHtml(stripTags(orgM[1])) : 'Higher Ed (via Chronicle)',
          org_type: 'university',
          location: locM ? decodeHtml(stripTags(locM[1])) : '',
          posted_date: dateM ? decodeHtml(stripTags(dateM[1])) : '',
          url: `https://jobs.chronicle.com${titleM[1]}`,
          ats_platform: 'chronicle',
          source_domain: 'jobs.chronicle.com',
        });
        foundOnPage++;
      }
      if (foundOnPage === 0) break;
    }
    await new Promise(r => setTimeout(r, 1100));
  }
  return found;
}

// ---- Idealist ----
// Tries the (undocumented) API first; falls back to HTML.
async function scrapeIdealist(query) {
  const found = [];

  // Attempt 1: JSON-ish API (may 403/CAPTCHA — handled by null return)
  const apiUrl = `https://www.idealist.org/api/v1/search?type=JOB&q=${encodeURIComponent(query)}&perPage=50`;
  const apiData = await fetchJson(apiUrl);
  if (apiData && Array.isArray(apiData.hits || apiData.results)) {
    const items = apiData.hits || apiData.results;
    for (const j of items) {
      const title = j.name || j.title || '';
      if (!title) continue;
      found.push({
        title,
        organization: j.org?.name || j.organization?.name || j.orgName || 'Nonprofit (via Idealist)',
        org_type: 'ngo',
        location: j.locationDisplay || j.location || (j.remote ? 'Remote' : ''),
        posted_date: j.createdAt || j.publishedAt || '',
        url: j.url || (j.slug ? `https://www.idealist.org/en/job/${j.slug}` : `https://www.idealist.org/en/jobs?q=${encodeURIComponent(query)}`),
        ats_platform: 'idealist',
        source_domain: 'idealist.org',
      });
    }
    return found;
  }

  // Attempt 2: HTML scrape of the public search page
  for (let page = 1; page <= 3; page++) {
    const url = `https://www.idealist.org/en/jobs?q=${encodeURIComponent(query)}&page=${page}`;
    const r = await fetchHtml(url);
    if (!r.ok || !r.body) break;
    const html = r.body;
    // Idealist uses Next.js — there's usually __NEXT_DATA__ JSON with structured data.
    const nextM = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextM) {
      try {
        const data = JSON.parse(nextM[1]);
        // The shape varies; search the tree for objects that look like jobs.
        const stack = [data];
        const seen = new Set();
        let foundOnPage = 0;
        while (stack.length) {
          const node = stack.pop();
          if (!node || typeof node !== 'object') continue;
          if (seen.has(node)) continue;
          seen.add(node);
          if (node.type === 'JOB' && node.name && node.url) {
            const u = node.url.startsWith('http') ? node.url : `https://www.idealist.org${node.url}`;
            found.push({
              title: node.name,
              organization: node.org?.name || node.orgName || 'Nonprofit (via Idealist)',
              org_type: 'ngo',
              location: node.locationDisplay || node.location?.displayName || (node.remote ? 'Remote' : ''),
              posted_date: node.createdAt || node.publishedAt || '',
              url: u,
              ats_platform: 'idealist',
              source_domain: 'idealist.org',
            });
            foundOnPage++;
          }
          for (const v of Object.values(node)) {
            if (v && typeof v === 'object') stack.push(v);
          }
        }
        if (foundOnPage === 0) break;
      } catch { break; }
    } else {
      break;
    }
    await new Promise(r => setTimeout(r, 1100));
  }
  return found;
}

const SITES = {
  higheredjobs: scrapeHigherEdJobs,
  chronicle:    scrapeChronicle,
  idealist:     scrapeIdealist,
  us_rse:       scrapeUsRse,
};
// Sites that hit a single curated URL (no per-query loop needed).
const SINGLE_URL_SITES = new Set(['higheredjobs', 'us_rse']);

function csvEsc(s) {
  if (s == null) return '';
  s = String(s);
  return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  const header = 'title,organization,org_type,location,remote,salary,posted_date,url,ats_platform,source_domain,scraped_at';
  await writeFile('jobs_aggregators.csv', header + '\n');

  const now = new Date().toISOString();
  let total = 0;
  let lastReported = 0;

  // Each site runs in parallel.
  const siteTasks = Object.entries(SITES).map(async ([siteName, scraper]) => {
    let siteTotal = 0;
    // Single-URL sites (HEDjobs uses a category-filtered URL; us-rse has one static page)
    // → no per-query loop. Multi-query sites (Chronicle, Idealist) cycle the keyword list.
    const queries = SINGLE_URL_SITES.has(siteName) ? [null] : AGGREGATOR_SEARCH_QUERIES;
    for (const q of queries) {
      let results;
      try { results = await scraper(q); }
      catch (e) { console.error(`  ! ${siteName} "${q || '(single-url)'}" error: ${e.message}`); continue; }
      // us-rse pre-filters to RSE roles; HEDjobs URL pre-filters to IT/software.
      // Apply the KEYWORDS title check anyway as a safety net (skips banner / footer / etc.).
      const swOnly = SINGLE_URL_SITES.has(siteName)
        ? results.filter(r => r.title && r.title.length > 3)
        : results.filter(r => titleMatches(r.title));
      for (const j of swOnly) {
        const loc = (j.location || '').toLowerCase();
        const remote = loc.includes('remote') ? 'yes' : (loc.includes('hybrid') ? 'hybrid' : 'no');
        const row = [
          j.title, j.organization, j.org_type, j.location, remote, '',
          j.posted_date, j.url, j.ats_platform, j.source_domain, now,
        ].map(csvEsc).join(',');
        await appendFile('jobs_aggregators.csv', row + '\n');
      }
      siteTotal += swOnly.length;
      total += swOnly.length;
      console.log(`  ${siteName.padEnd(13)} q="${q || '(single-url)'}" → ${results.length} raw, ${swOnly.length} kept (site total ${siteTotal})`);
      if (Math.floor(total / 100) > Math.floor(lastReported / 100)) {
        console.log(`>>> Aggregator running count: ${total}`);
        lastReported = total;
      }
    }
    console.log(`${siteName} DONE: ${siteTotal} jobs.`);
  });

  await Promise.all(siteTasks);
  console.log(`\nAll aggregators done. jobs_aggregators.csv has ${total} software jobs.`);
}

main().catch(e => { console.error(e); process.exit(1); });
