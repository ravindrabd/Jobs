// Aggregator scraper: hospitaljobsonline.com (HJO)
// Plain HTML, 50 jobs per page, ?page=N pagination. No bot challenge needed.
// Tag every job: org_type=hospital, ats_platform=hjo, source_domain=hospitaljobsonline.com
// Apply the project's KEYWORDS filter so we only keep IT/software titles.

import { writeFile, appendFile, readFile } from 'fs/promises';
import * as cheerio from 'cheerio';

process.setMaxListeners(0);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// 13 high-signal hospital-IT keywords
const KEYWORDS_TO_SEARCH = [
  'informatics', 'epic', 'cerner', 'meditech',
  'software', 'developer', 'programmer', 'engineer',
  'analyst', 'database', 'systems administrator',
  'application analyst', 'health information',
];

// Title filter — copied from import.js so the scraper writes only real software titles.
const KEYWORDS = [
  'software engineer','software developer','software programmer','application engineer',
  'application developer','systems engineer','systems developer','systems programmer',
  'computer scientist','research engineer','research software','scientific programmer',
  'computational scientist','research computing','frontend','front-end','front end',
  'ui engineer','ui developer','ux engineer','web developer','web engineer','web programmer',
  'javascript developer','react developer','angular developer','vue developer',
  'typescript developer','html developer','backend','back-end','back end','api developer',
  'api engineer','python developer','java developer','golang developer','go developer',
  'ruby developer','php developer','scala developer','rust developer','c++ developer',
  'c# developer','.net developer','node developer','django developer','rails developer',
  'spring developer','full stack','fullstack','full-stack','mobile developer','mobile engineer',
  'ios developer','ios engineer','android developer','android engineer','react native',
  'flutter developer','swift developer','kotlin developer','data engineer','data developer',
  'data architect','data analyst','data scientist','analytics engineer','business intelligence',
  'bi developer','bi engineer','etl developer','etl engineer','pipeline engineer',
  'database developer','database engineer','database administrator','dba','sql developer',
  'nosql developer','spark developer','hadoop developer','kafka engineer','machine learning',
  'ml engineer','ml developer','ai engineer','ai developer','deep learning','nlp engineer',
  'computer vision','data science','llm engineer','generative ai','prompt engineer',
  'applied scientist','research scientist','cloud engineer','cloud developer','cloud architect',
  'infrastructure engineer','infrastructure developer','platform engineer','platform developer',
  'devops','dev ops','site reliability','sre','devsecops','release engineer','build engineer',
  'ci/cd','kubernetes engineer','aws engineer','azure engineer','gcp engineer','security engineer',
  'security developer','cybersecurity engineer','appsec engineer','application security',
  'penetration tester','security analyst','information security','infosec','qa engineer',
  'qa developer','quality engineer','test engineer','automation engineer','sdet','software tester',
  'solutions architect','software architect','enterprise architect','technical architect',
  'tech lead','technical lead','staff engineer','principal engineer','distinguished engineer',
  'engineering manager','director of engineering','vp engineering','vp of engineering','cto',
  'chief technology','head of engineering','systems administrator','sysadmin','it engineer',
  'it developer','network engineer','network developer','it analyst','enterprise systems',
  'erp developer','salesforce developer','sharepoint developer','it architect','it manager',
  'application administrator','technology analyst','information systems',
  'information technology developer','gis developer','gis analyst','geospatial developer',
  'bioinformatics','cheminformatics','computational biologist','research programmer',
  'scientific software','blockchain developer','web3 developer','smart contract',
  'embedded developer','embedded engineer','firmware engineer','iot developer','robotics engineer',
  'epic analyst','epic certified','epic developer','epic builder','epic implementation',
  'cerner analyst','cerner developer','cerner specialist',
  'ehr analyst','emr analyst','ehr specialist','emr specialist',
  'clinical informatics','health informatics','medical informatics','nursing informatics',
  'pharmacy informatics','radiology informatics','imaging informatics',
  'application analyst','application specialist','clinical applications',
  'him analyst','him specialist','health information management',
  'biostatistician','clinical data manager','clinical data analyst',
  'health data analyst','healthcare data analyst','pacs administrator',
  'revenue cycle analyst','meditech analyst','meditech specialist',
];
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const KW_RES = KEYWORDS.map(k => new RegExp(`(?:^|[^a-z0-9])${escapeRe(k.toLowerCase())}(?:[^a-z0-9]|$)`, 'i'));
const isSoftware = (t) => !!t && KW_RES.some(r => r.test(t));

function csvEsc(s) { if (s == null) return ''; s = String(s); return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

async function fetchHtml(url, ms = 15000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html' } });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
  finally { clearTimeout(t); }
}

async function scrapeHjo(keyword) {
  const out = [];
  // HJO uses slug-based search URLs: /jobs/{keyword-with-hyphens}-jobs/
  const slug = keyword.toLowerCase().replace(/\s+/g, '-');
  for (let page = 1; page <= 20; page++) {
    const url = `https://www.hospitaljobsonline.com/jobs/${slug}-jobs?page=${page}`;
    const html = await fetchHtml(url);
    if (!html) break;
    const $ = cheerio.load(html);
    // Job rows: anchors with /job/NNN/slug/ — each job has 2 anchors (title link + image link),
    // dedupe by URL within the page.
    const seenOnPage = new Set();
    let foundOnPage = 0;
    for (const a of $('a[href*="/job/"]').toArray()) {
      const $a = $(a);
      const href = $a.attr('href') || '';
      if (!/\/job\/\d+\//.test(href)) continue;
      const full = href.startsWith('http') ? href : 'https://www.hospitaljobsonline.com' + href;
      if (seenOnPage.has(full)) continue;
      seenOnPage.add(full);
      const title = $a.text().replace(/\s+/g, ' ').trim();
      if (!title || title.length < 4) continue;
      // The surrounding row usually contains the city/state + employer somewhere.
      const row = $a.closest('div, li, tr, article');
      const rowText = row.text().replace(/\s+/g, ' ').trim().slice(0, 400);
      const locMatch = rowText.match(/(Remote|Hybrid|[A-Z][A-Za-z .'&-]+,\s*[A-Z]{2})/);
      // Posted date sometimes shows up as "Posted X days ago" or a date
      const dateMatch = rowText.match(/Posted[:\s]+([A-Za-z]+ \d{1,2},\s*\d{4}|\d+\s+days?\s+ago|Yesterday|Today)/i);
      out.push({
        title,
        organization: 'Hospital (via Hospital Jobs Online)',
        org_type: 'hospital',
        location: locMatch ? locMatch[1] : '',
        salary: '',
        posted_date: dateMatch ? `Posted ${dateMatch[1]}` : '',
        url: full,
        ats_platform: 'hjo',
        source_domain: 'hospitaljobsonline.com',
      });
      foundOnPage++;
    }
    if (foundOnPage === 0) break;
    await new Promise(r => setTimeout(r, 800));
  }
  return out;
}

async function main() {
  const outPath = 'jobs_hjo.csv';
  const header = 'title,organization,org_type,location,remote,salary,posted_date,url,ats_platform,source_domain,scraped_at';
  await writeFile(outPath, header + '\n');
  const now = new Date().toISOString();

  const seenUrls = new Set();
  let total = 0, totalKept = 0;
  for (let i = 0; i < KEYWORDS_TO_SEARCH.length; i++) {
    const kw = KEYWORDS_TO_SEARCH[i];
    let results = [];
    try { results = await scrapeHjo(kw); }
    catch (e) { console.error('  err:', e.message); continue; }
    let added = 0, kept = 0;
    for (const r of results) {
      if (seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      added++;
      if (!isSoftware(r.title)) continue;
      kept++;
      const row = [r.title, r.organization, r.org_type, r.location, 'no', r.salary,
                   r.posted_date, r.url, r.ats_platform, r.source_domain, now]
                   .map(csvEsc).join(',');
      await appendFile(outPath, row + '\n');
    }
    total += added; totalKept += kept;
    console.log(`  [${i+1}/${KEYWORDS_TO_SEARCH.length}] ${kw.padEnd(20)} → ${results.length} raw, ${added} unique, ${kept} kept`);
  }
  console.log(`\nDONE. Unique URLs: ${total}. Software-filtered kept: ${totalKept}. Output: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
