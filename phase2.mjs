// Phase 2: Scrape software jobs from each ATS platform
// Input:  orgs.csv (from Phase 1)
// Output: jobs.csv

import { readFile, writeFile, appendFile } from 'fs/promises';

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

// Search-query cycle for full-text aggregator sites (HigherEdJobs, Chronicle, Idealist).
// Not used yet — scrapers for those sites aren't built. Kept here for future wiring.
const AGGREGATOR_SEARCH_QUERIES = [
  'software engineer', 'developer', 'data engineer', 'devops',
  'machine learning', 'cloud engineer', 'security engineer',
  'web developer', 'mobile developer', 'systems administrator',
  'research software', 'GIS developer', 'bioinformatics',
];

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// Word-boundary regex per keyword. `\b` treats hyphen/space/punctuation as boundaries,
// which is exactly what we want — prevents "cto" matching "director", "ios" matching "studios", etc.
const KW_RES = KEYWORDS.map(k => new RegExp(`(?:^|[^a-z0-9])${escapeRe(k.toLowerCase())}(?:[^a-z0-9]|$)`, 'i'));
function titleMatches(title) {
  if (!title) return false;
  return KW_RES.some(re => re.test(title));
}

function pLimit(n) {
  let active = 0; const queue = [];
  const next = () => {
    while (active < n && queue.length) {
      const { fn, resolve, reject } = queue.shift();
      active++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
    }
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

async function fetchJson(url, opts = {}, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; JobScout/1.0)',
        'accept': 'application/json',
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

// ---- Per-ATS scrapers ----

async function scrapeGreenhouse(org) {
  if (!org.slug) return [];
  const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${org.slug}/jobs?content=false`);
  if (!data || !data.jobs) return [];
  return data.jobs.map(j => ({
    title: j.title,
    location: j.location?.name || '',
    posted_date: j.updated_at || '',
    url: j.absolute_url,
  }));
}

async function scrapeLever(org) {
  if (!org.slug) return [];
  const data = await fetchJson(`https://api.lever.co/v0/postings/${org.slug}?mode=json`);
  if (!Array.isArray(data)) return [];
  return data.map(j => ({
    title: j.text,
    location: j.categories?.location || '',
    posted_date: j.createdAt ? new Date(j.createdAt).toISOString() : '',
    url: j.hostedUrl,
  }));
}

async function scrapeAshby(org) {
  if (!org.slug) return [];
  // Public job board API
  const data = await fetchJson(
    `https://api.ashbyhq.com/posting-api/job-board/${org.slug}?includeCompensation=true`
  );
  if (!data || !data.jobs) return [];
  return data.jobs.map(j => ({
    title: j.title,
    location: j.locationName || j.location || '',
    posted_date: j.publishedAt || j.updatedAt || '',
    url: j.jobUrl || `https://jobs.ashbyhq.com/${org.slug}/${j.id}`,
  }));
}

async function scrapeWorkable(org) {
  if (!org.slug) return [];
  const data = await fetchJson(
    `https://apply.workable.com/api/v3/accounts/${org.slug}/jobs`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '', location: [], department: [], workplace: [] }) }
  );
  if (!data || !data.results) return [];
  return data.results.map(j => ({
    title: j.title,
    location: [j.city, j.state, j.country].filter(Boolean).join(', ') || (j.remote ? 'Remote' : ''),
    posted_date: j.created_at || j.published_on || '',
    url: j.shortlink || `https://apply.workable.com/${org.slug}/j/${j.shortcode}`,
  }));
}

async function scrapeWorkday(org) {
  if (!org.tenant || !org.site) return [];
  const candidates = [];
  if (org.wd_prefix) {
    candidates.push({ shape: 'A', host: `${org.tenant}.${org.wd_prefix}.myworkdayjobs.com` });
    candidates.push({ shape: 'B', host: `${org.wd_prefix}.myworkdaysite.com` });
  } else {
    for (const p of ['wd1','wd5','wd3','wd10','wd501','wd503','wd108']) {
      candidates.push({ shape: 'A', host: `${org.tenant}.${p}.myworkdayjobs.com` });
    }
  }

  // Helper: paginate one filtered search and tag jobs with override_org_name.
  async function paginate(host, shape, appliedFacets, override_org_name) {
    const url = `https://${host}/wday/cxs/${org.tenant}/${org.site}/jobs`;
    const out = [];
    let offset = 0, attempts = 0;
    let firstFacets = null;
    while (attempts++ < 25) {
      const data = await fetchJson(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appliedFacets, limit: 20, offset, searchText: '' }),
      });
      if (!data || !data.jobPostings) break;
      if (!firstFacets && data.facets) firstFacets = data.facets;
      for (const j of data.jobPostings) {
        const jobUrl = shape === 'A'
          ? `https://${host}/en-US/${org.site}${j.externalPath || ''}`
          : `https://${host}/recruiting/${org.tenant}/${org.site}${j.externalPath || ''}`;
        out.push({
          title: j.title,
          location: j.locationsText || '',
          posted_date: j.postedOn || '',
          url: jobUrl,
          override_org_name,
        });
      }
      if (data.jobPostings.length < 20) break;
      offset += 20;
    }
    return { jobs: out, facets: firstFacets };
  }

  for (const c of candidates) {
    // First fetch: probe whether host responds AND get facets (no filter applied).
    const initial = await paginate(c.host, c.shape, {}, null);
    if (!initial.jobs.length && !initial.facets) continue; // host didn't respond

    // Look for hiringCompany facet (multi-institution Workday installs).
    const hc = (initial.facets || []).find(f => f.facetParameter === 'hiringCompany');
    const companies = hc?.values || [];

    if (companies.length <= 1) {
      // Single-tenant install — initial jobs are fine; org_name stays the discovery-time value.
      return initial.jobs;
    }

    // Multi-tenant: re-scrape per company so each job is correctly attributed.
    const all = [];
    for (const co of companies) {
      const res = await paginate(c.host, c.shape, { hiringCompany: [co.id] }, co.descriptor);
      all.push(...res.jobs);
    }
    return all;
  }
  return [];
}

async function scrapeSmartRecruiters(org) {
  if (!org.slug) return [];
  const data = await fetchJson(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(org.slug)}/postings?limit=100`
  );
  if (!data || !data.content) return [];
  return data.content.map(j => ({
    title: j.name,
    location: [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', '),
    posted_date: j.releasedDate || j.createdOn || '',
    url: j.ref || `https://jobs.smartrecruiters.com/${org.slug}/${j.id}`,
  }));
}

const SCRAPERS = {
  greenhouse:      scrapeGreenhouse,
  lever:           scrapeLever,
  ashby:           scrapeAshby,
  workable:        scrapeWorkable,
  workday:         scrapeWorkday,
  smartrecruiters: scrapeSmartRecruiters,
};

function csvEsc(s) {
  if (s == null) return '';
  s = String(s);
  return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  return lines.slice(1).map(line => {
    // small CSV parser handling quoted fields
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQ = false; }
        else cur += c;
      } else {
        if (c === ',') { fields.push(cur); cur = ''; }
        else if (c === '"') inQ = true;
        else cur += c;
      }
    }
    fields.push(cur);
    const row = {};
    header.forEach((h, i) => row[h] = fields[i] || '');
    return row;
  });
}

const ATS_PRIORITY = { greenhouse: 1, lever: 2, workday: 3, ashby: 4, workable: 5, smartrecruiters: 6 };

async function main() {
  const orgsCsv = await readFile('orgs.csv', 'utf8');
  let orgs = parseCsv(orgsCsv).filter(o => SCRAPERS[o.ats_platform]);
  // Dedup orgs by (ats_platform, tenant, site, slug) so we never hit the same Workday tenant twice.
  const seen = new Set();
  orgs = orgs.filter(o => {
    const key = [o.ats_platform, o.tenant || '', o.site || '', o.slug || ''].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  orgs.sort((a, b) => (ATS_PRIORITY[a.ats_platform] || 99) - (ATS_PRIORITY[b.ats_platform] || 99));
  console.log(`Loaded ${orgs.length} unique scrapeable orgs after (ats, tenant, site, slug) dedup`);

  const header = 'title,organization,org_type,location,remote,salary,posted_date,url,ats_platform,source_domain,scraped_at';
  await writeFile('jobs.csv', header + '\n');

  const limit = pLimit(15);
  const now = new Date().toISOString();
  let jobsTotal = 0;
  let lastReported = 0;
  let orgsDone = 0;

  const tasks = orgs.map(o => limit(async () => {
    const scraper = SCRAPERS[o.ats_platform];
    const jobs = await scraper(o);
    const sw = jobs.filter(j => titleMatches(j.title));
    for (const j of sw) {
      const loc = (j.location || '').toLowerCase();
      const remote = loc.includes('remote') ? 'yes' : (loc.includes('hybrid') ? 'hybrid' : 'no');
      // Prefer per-job institution (Workday hiringCompany facet) over discovery-time org name.
      const orgName = j.override_org_name || o.name;
      const row = [
        j.title, orgName, o.org_type, j.location, remote, '',
        j.posted_date, j.url, o.ats_platform, o.domain, now,
      ].map(csvEsc).join(',');
      await appendFile('jobs.csv', row + '\n');
    }
    jobsTotal += sw.length;
    orgsDone++;
    if (sw.length > 0) {
      console.log(`  + ${o.name} (${o.ats_platform}): ${jobs.length} jobs → ${sw.length} software`);
    }
    if (Math.floor(jobsTotal / 100) > Math.floor(lastReported / 100)) {
      console.log(`>>> Running count: ${jobsTotal} software jobs (${orgsDone}/${orgs.length} orgs done)`);
      lastReported = jobsTotal;
    }
  }));

  await Promise.all(tasks);
  console.log(`\nDone. jobs.csv has ${jobsTotal} software jobs across ${orgsDone} orgs.`);
}

main().catch(e => { console.error(e); process.exit(1); });
