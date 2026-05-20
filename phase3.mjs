// Phase 3: Deduplicate, score competition, export clean CSV
// Input:  jobs.csv (from Phase 2)
// Output: jobs_clean.csv, jobs_low_competition.csv, summary.txt
//         + prints top 20 low-competition remote software jobs to stdout

import { readFile, writeFile as _writeFile, mkdir } from 'fs/promises';
import path from 'path';

const OUT_DIR = 'out';

async function writeFile(filename, data) {
  await mkdir(OUT_DIR, { recursive: true });
  const full = path.join(OUT_DIR, filename);
  for (let attempt = 1; attempt <= 6; attempt++) {
    try { return await _writeFile(full, data); }
    catch (e) {
      if (attempt === 6 || !['EBUSY','EPERM','EACCES'].includes(e.code)) throw e;
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}

const KEYWORDS = [
  // Core engineering
  'software engineer', 'software developer', 'software programmer',
  'application engineer', 'application developer', 'systems engineer',
  'systems developer', 'systems programmer', 'computer scientist',
  'research engineer', 'research software', 'scientific programmer',
  'computational scientist', 'research computing',
  // Web & frontend
  'frontend', 'front-end', 'front end', 'ui engineer', 'ui developer',
  'ux engineer', 'web developer', 'web engineer', 'web programmer',
  'javascript developer', 'react developer', 'angular developer',
  'vue developer', 'typescript developer', 'html developer',
  // Backend & APIs
  'backend', 'back-end', 'back end', 'api developer', 'api engineer',
  'python developer', 'java developer', 'golang developer', 'go developer',
  'ruby developer', 'php developer', 'scala developer', 'rust developer',
  'c++ developer', 'c# developer', '.net developer', 'node developer',
  'django developer', 'rails developer', 'spring developer',
  // Full stack
  'full stack', 'fullstack', 'full-stack',
  // Mobile
  'mobile developer', 'mobile engineer', 'ios developer', 'ios engineer',
  'android developer', 'android engineer', 'react native', 'flutter developer',
  'swift developer', 'kotlin developer',
  // Data & analytics
  'data engineer', 'data developer', 'data architect', 'data analyst',
  'data scientist', 'analytics engineer', 'business intelligence',
  'bi developer', 'bi engineer', 'etl developer', 'etl engineer',
  'pipeline engineer', 'database developer', 'database engineer',
  'database administrator', 'dba', 'sql developer', 'nosql developer',
  'spark developer', 'hadoop developer', 'kafka engineer',
  // AI & machine learning
  'machine learning', 'ml engineer', 'ml developer', 'ai engineer',
  'ai developer', 'deep learning', 'nlp engineer', 'computer vision',
  'data science', 'llm engineer', 'generative ai', 'prompt engineer',
  'applied scientist', 'research scientist',
  // Cloud & infrastructure
  'cloud engineer', 'cloud developer', 'cloud architect',
  'infrastructure engineer', 'infrastructure developer',
  'platform engineer', 'platform developer', 'devops', 'dev ops',
  'site reliability', 'sre', 'devsecops', 'release engineer',
  'build engineer', 'ci/cd', 'kubernetes engineer', 'aws engineer',
  'azure engineer', 'gcp engineer',
  // Security
  'security engineer', 'security developer', 'cybersecurity engineer',
  'appsec engineer', 'application security', 'penetration tester',
  'security analyst', 'information security', 'infosec',
  // QA & testing
  'qa engineer', 'qa developer', 'quality engineer', 'test engineer',
  'automation engineer', 'sdet', 'software tester',
  // Architecture & leadership
  'solutions architect', 'software architect', 'enterprise architect',
  'technical architect', 'tech lead', 'technical lead', 'staff engineer',
  'principal engineer', 'distinguished engineer', 'engineering manager',
  'director of engineering', 'vp engineering', 'vp of engineering',
  'cto', 'chief technology', 'head of engineering',
  // IT & systems
  'systems administrator', 'sysadmin', 'it engineer', 'it developer',
  'network engineer', 'network developer', 'it analyst',
  'enterprise systems', 'erp developer', 'salesforce developer',
  'sharepoint developer', 'it architect', 'it manager',
  'application administrator', 'technology analyst',
  'information systems', 'information technology developer',
  // GIS & research tech
  'gis developer', 'gis analyst', 'geospatial developer',
  'bioinformatics', 'cheminformatics', 'computational biologist',
  'research programmer', 'scientific software',
  // Blockchain & emerging
  'blockchain developer', 'web3 developer', 'smart contract',
  'embedded developer', 'embedded engineer', 'firmware engineer',
  'iot developer', 'robotics engineer',
];

// Search-query cycle for HigherEdJobs / Chronicle / Idealist (scrapers not built yet).
const AGGREGATOR_SEARCH_QUERIES = [
  'software engineer', 'developer', 'data engineer', 'devops',
  'machine learning', 'cloud engineer', 'security engineer',
  'web developer', 'mobile developer', 'systems administrator',
  'research software', 'GIS developer', 'bioinformatics',
];

// Top-50 US universities (rough — Forbes/US News/QS overlap). Used to mark "high competition".
const TOP_50_UNIS = new Set([
  'massachusetts institute of technology', 'mit', 'harvard university', 'stanford university',
  'princeton university', 'yale university', 'columbia university', 'university of pennsylvania',
  'california institute of technology', 'caltech', 'duke university', 'university of chicago',
  'johns hopkins university', 'northwestern university', 'dartmouth college', 'brown university',
  'cornell university', 'vanderbilt university', 'rice university', 'washington university in st. louis',
  'university of notre dame', 'emory university', 'georgetown university', 'carnegie mellon university',
  'university of california, berkeley', 'university of california, los angeles', 'ucla', 'uc berkeley',
  'university of michigan', 'university of virginia', 'university of north carolina at chapel hill',
  'new york university', 'nyu', 'university of southern california', 'usc',
  'university of florida', 'university of texas at austin', 'university of wisconsin-madison',
  'georgia institute of technology', 'georgia tech', 'university of illinois urbana-champaign',
  'boston college', 'boston university', 'tufts university', 'university of california, san diego',
  'university of california, davis', 'university of california, irvine', 'university of california, santa barbara',
  'purdue university', 'pennsylvania state university', 'penn state', 'ohio state university',
  'university of washington', 'university of maryland', 'rutgers university', 'university of minnesota',
  'university of rochester', 'case western reserve university', 'lehigh university',
]);

// Well-known tech / FAANG-adjacent orgs (none should be in our org list, but defensive)
const FAANG_TIER = new Set([
  'google', 'meta', 'facebook', 'amazon', 'apple', 'microsoft', 'netflix',
  'stripe', 'airbnb', 'uber', 'lyft', 'tesla', 'spacex', 'openai', 'anthropic',
  'palantir', 'databricks', 'snowflake', 'salesforce', 'oracle', 'ibm', 'nvidia',
]);

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',');
  return lines.slice(1).map(line => {
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === ',') { fields.push(cur); cur = ''; }
        else if (c === '"') inQ = true;
        else cur += c;
      }
    }
    fields.push(cur);
    const row = {};
    header.forEach((h, i) => row[h] = (fields[i] ?? '').trim());
    return row;
  });
}

function csvEsc(s) {
  if (s == null) return '';
  s = String(s);
  return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const KW_LOWER = KEYWORDS.map(k => k.toLowerCase());

function titleMatchesSoftware(title) {
  if (!title) return false;
  const t = title.toLowerCase();
  return KW_LOWER.some(k => t.includes(k));
}

function normalizeTitle(t) {
  return (t || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function detectRemote(location) {
  const l = (location || '').toLowerCase();
  if (l.includes('remote')) return 'yes';
  if (l.includes('hybrid')) return 'hybrid';
  return 'no';
}

function daysSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

function scoreCompetition(job) {
  const orgLower = (job.organization || '').toLowerCase();
  const ats = (job.ats_platform || '').toLowerCase();
  const days = daysSince(job.posted_date);

  // HIGH signals
  if (FAANG_TIER.has(orgLower)) return 'high';
  if (job.org_type === 'university' && TOP_50_UNIS.has(orgLower)) return 'high';
  if (days !== null && days < 3) {
    // recent + easy-apply ATS → high. recent alone → medium.
    if (ats === 'greenhouse' || ats === 'lever') return 'high';
  }

  // LOW signals
  if (job.org_type === 'university' && !TOP_50_UNIS.has(orgLower)) return 'low';
  if (job.org_type === 'ngo') return 'low';
  if (job.org_type === 'small_org') return 'low';
  if (days !== null && days > 14) return 'low';
  if (ats === 'workday' || ats === 'taleo') return 'low';

  return 'medium';
}

async function main() {
  const inputPath = process.argv[2] || 'jobs.csv';
  console.log(`Reading ${inputPath}...`);
  const raw = await readFile(inputPath, 'utf8');
  const jobs = parseCsv(raw);
  console.log(`Loaded ${jobs.length} raw jobs`);

  // Filter to software roles and required org types
  const filtered = jobs.filter(j =>
    titleMatchesSoftware(j.title) &&
    ['university', 'ngo', 'small_org'].includes(j.org_type) &&
    (j.ats_platform || '').toLowerCase() !== 'neogov'
  );
  console.log(`${filtered.length} jobs after software/org/ATS filter`);

  // Dedup: same normalized title + organization + location, keep newest posted_date
  const dedupMap = new Map();
  for (const j of filtered) {
    const key = `${normalizeTitle(j.title)}|${(j.organization||'').toLowerCase()}|${(j.location||'').toLowerCase()}`;
    const existing = dedupMap.get(key);
    if (!existing) {
      dedupMap.set(key, j);
    } else {
      const oldD = Date.parse(existing.posted_date) || 0;
      const newD = Date.parse(j.posted_date) || 0;
      if (newD > oldD) dedupMap.set(key, j);
    }
  }
  const deduped = [...dedupMap.values()];
  console.log(`${filtered.length} -> ${deduped.length} after dedup`);

  // Enrich
  for (const j of deduped) {
    j.remote = detectRemote(j.location);
    j.competition_level = scoreCompetition(j);
  }

  // Sort by posted_date desc (unparseable goes last)
  deduped.sort((a, b) => (Date.parse(b.posted_date) || 0) - (Date.parse(a.posted_date) || 0));

  // Write jobs_clean.csv
  const outCols = ['title','organization','org_type','location','remote','salary',
                   'posted_date','url','ats_platform','source_domain','scraped_at','competition_level'];
  const cleanHeader = outCols.join(',');
  const cleanRows = deduped.map(j => outCols.map(c => csvEsc(j[c] ?? '')).join(','));
  await writeFile('jobs_clean.csv', [cleanHeader, ...cleanRows].join('\n') + '\n');

  // Write jobs_low_competition.csv
  const low = deduped.filter(j => j.competition_level === 'low');
  const lowRows = low.map(j => outCols.map(c => csvEsc(j[c] ?? '')).join(','));
  await writeFile('jobs_low_competition.csv', [cleanHeader, ...lowRows].join('\n') + '\n');

  // Summary
  const byOrgType = {}, byAts = {}, byRemote = {}, byComp = {};
  for (const j of deduped) {
    byOrgType[j.org_type] = (byOrgType[j.org_type] || 0) + 1;
    byAts[j.ats_platform] = (byAts[j.ats_platform] || 0) + 1;
    byRemote[j.remote] = (byRemote[j.remote] || 0) + 1;
    byComp[j.competition_level] = (byComp[j.competition_level] || 0) + 1;
  }
  const summary = [
    `Job-Scrape Summary`,
    `==================`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `Raw jobs:        ${jobs.length}`,
    `After filter:    ${filtered.length}`,
    `After dedup:     ${deduped.length}`,
    `Low competition: ${low.length}`,
    ``,
    `By org type:`,
    ...Object.entries(byOrgType).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `  ${k.padEnd(15)} ${v}`),
    ``,
    `By ATS:`,
    ...Object.entries(byAts).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `  ${k.padEnd(15)} ${v}`),
    ``,
    `By remote:`,
    ...Object.entries(byRemote).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `  ${k.padEnd(15)} ${v}`),
    ``,
    `By competition:`,
    ...Object.entries(byComp).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `  ${k.padEnd(15)} ${v}`),
    ``,
  ].join('\n');
  await writeFile('summary.txt', summary);

  // Top 20 low-competition remote
  const topLowRemote = deduped
    .filter(j => j.competition_level === 'low' && j.remote === 'yes')
    .slice(0, 20);

  console.log('\n' + summary);
  console.log('\n=== TOP 20 LOW-COMPETITION REMOTE SOFTWARE JOBS ===\n');
  if (topLowRemote.length === 0) {
    console.log('(none found — try widening filters or rerunning Phase 1/2 with more orgs)');
  } else {
    topLowRemote.forEach((j, i) => {
      console.log(`${(i+1).toString().padStart(2)}. ${j.title}`);
      console.log(`    ${j.organization} [${j.org_type}, ${j.ats_platform}]`);
      console.log(`    ${j.location || '(no location)'}  |  posted: ${j.posted_date || '(unknown)'}`);
      console.log(`    ${j.url}`);
      console.log('');
    });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
