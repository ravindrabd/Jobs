// Hospital Step 3: Scrape software jobs from hospitals with detected ATS.
// Reuses Workday/Greenhouse/Lever/Workable/SmartRecruiters scrapers from phase2.
// Adds iCIMS and Jobvite scrapers (new for healthcare).
// Filters to software-only via the same KEYWORDS substring rule.
// Output: out/jobs_hospitals.csv

import { readFile, writeFile, appendFile, mkdir } from 'fs/promises';
import path from 'path';

process.setMaxListeners(0);

const OUT_DIR = 'out';

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
];
const KW_LOWER = KEYWORDS.map(k => k.toLowerCase());
function titleMatches(title) {
  if (!title) return false;
  const t = title.toLowerCase();
  return KW_LOWER.some(k => t.includes(k));
}

const UA = 'Mozilla/5.0 (compatible; JobScout/1.0)';

function pLimit(n) {
  let active = 0, queue = [];
  const next = () => {
    while (active < n && queue.length) {
      const { fn, resolve, reject } = queue.shift();
      active++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
    }
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

async function fetchJson(url, opts = {}, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: 'application/json', ...(opts.headers || {}) },
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('json')) return null;
    return await r.json();
  } catch { return null; }
  finally { clearTimeout(t); }
}

async function fetchHtml(url, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html' },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
  finally { clearTimeout(t); }
}

// ---------- Existing JSON-API scrapers ----------
async function scrapeGreenhouse(o) {
  if (!o.slug) return [];
  const d = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${o.slug}/jobs?content=false`);
  if (!d?.jobs) return [];
  return d.jobs.map(j => ({ title: j.title, location: j.location?.name || '', posted_date: j.updated_at || '', url: j.absolute_url }));
}
async function scrapeLever(o) {
  if (!o.slug) return [];
  const d = await fetchJson(`https://api.lever.co/v0/postings/${o.slug}?mode=json`);
  if (!Array.isArray(d)) return [];
  return d.map(j => ({ title: j.text, location: j.categories?.location || '', posted_date: j.createdAt ? new Date(j.createdAt).toISOString() : '', url: j.hostedUrl }));
}
async function scrapeAshby(o) {
  if (!o.slug) return [];
  const d = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${o.slug}?includeCompensation=true`);
  if (!d?.jobs) return [];
  return d.jobs.map(j => ({ title: j.title, location: j.locationName || j.location || '', posted_date: j.publishedAt || j.updatedAt || '', url: j.jobUrl || `https://jobs.ashbyhq.com/${o.slug}/${j.id}` }));
}
async function scrapeWorkable(o) {
  if (!o.slug) return [];
  const d = await fetchJson(
    `https://apply.workable.com/api/v3/accounts/${o.slug}/jobs`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '', location: [], department: [], workplace: [] }) }
  );
  if (!d?.results) return [];
  return d.results.map(j => ({ title: j.title, location: [j.city,j.state,j.country].filter(Boolean).join(', ') || (j.remote ? 'Remote' : ''), posted_date: j.created_at || j.published_on || '', url: j.shortlink || `https://apply.workable.com/${o.slug}/j/${j.shortcode}` }));
}
async function scrapeSmartRecruiters(o) {
  if (!o.slug) return [];
  const d = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(o.slug)}/postings?limit=100`);
  if (!d?.content) return [];
  return d.content.map(j => ({ title: j.name, location: [j.location?.city,j.location?.region,j.location?.country].filter(Boolean).join(', '), posted_date: j.releasedDate || j.createdOn || '', url: j.ref || `https://jobs.smartrecruiters.com/${o.slug}/${j.id}` }));
}
async function scrapeWorkday(o) {
  if (!o.tenant || !o.site) return [];
  const candidates = [];
  if (o.wd_prefix) {
    candidates.push({ shape: 'A', host: `${o.tenant}.${o.wd_prefix}.myworkdayjobs.com` });
    candidates.push({ shape: 'B', host: `${o.wd_prefix}.myworkdaysite.com` });
  } else {
    for (const p of ['wd1','wd5','wd3','wd10','wd501','wd503','wd108']) {
      candidates.push({ shape: 'A', host: `${o.tenant}.${p}.myworkdayjobs.com` });
    }
  }
  for (const c of candidates) {
    const url = `https://${c.host}/wday/cxs/${o.tenant}/${o.site}/jobs`;
    const all = [];
    let offset = 0, attempts = 0;
    while (attempts++ < 25) {
      const d = await fetchJson(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
      });
      if (!d?.jobPostings) break;
      all.push(...d.jobPostings);
      if (d.jobPostings.length < 20) break;
      offset += 20;
    }
    if (all.length) {
      return all.map(j => {
        const u = c.shape === 'A'
          ? `https://${c.host}/en-US/${o.site}${j.externalPath || ''}`
          : `https://${c.host}/recruiting/${o.tenant}/${o.site}${j.externalPath || ''}`;
        return { title: j.title, location: j.locationsText || (j.bulletFields || []).join(', '), posted_date: j.postedOn || '', url: u };
      });
    }
  }
  return [];
}

// ---------- NEW: iCIMS scraper (HTML, since their JSON endpoint is not public) ----------
async function scrapeICIMS(o) {
  if (!o.tenant) return [];
  const hosts = [
    `careers-${o.tenant}.icims.com`,
    `${o.tenant}.icims.com`,
  ];
  for (const host of hosts) {
    const all = [];
    let startIndex = 0;
    let consecutiveEmpty = 0;
    while (startIndex < 500) {
      // Empty keyword → return all postings; we KEYWORDS-filter client-side.
      const url = `https://${host}/jobs/search?ss=1&searchKeyword=&startIndex=${startIndex}`;
      const html = await fetchHtml(url, 15000);
      if (!html) { consecutiveEmpty++; if (consecutiveEmpty > 1) break; startIndex += 25; continue; }
      // Extract <a> tags pointing to /jobs/NNN/title — iCIMS canonical job link format.
      const re = /<a[^>]+href="(\/jobs\/\d+[^"]*)"[^>]*>([^<]{3,200})<\/a>/g;
      let m, foundOnPage = 0;
      const seen = new Set();
      while ((m = re.exec(html)) !== null) {
        const href = m[1];
        if (seen.has(href)) continue;
        seen.add(href);
        const title = m[2].replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
        if (!title || /apply now|view all|see all/i.test(title)) continue;
        all.push({
          title,
          location: '',           // iCIMS HTML rarely exposes location inline reliably
          posted_date: '',
          url: `https://${host}${href}`,
        });
        foundOnPage++;
      }
      if (foundOnPage === 0) break;
      startIndex += 25;
    }
    if (all.length) return all;
  }
  return [];
}

// ---------- NEW: Jobvite scraper ----------
async function scrapeJobvite(o) {
  // Strategy: try the documented job-feed JSON first; if that fails, fall back to HTML on jobs.jobvite.com/{slug}
  if (o.company_id) {
    const d = await fetchJson(`https://jobs.jobvite.com/api/company/${o.company_id}/jobs?q=software`);
    if (Array.isArray(d)) {
      return d.map(j => ({
        title: j.title || j.name || '',
        location: j.location || j.city || '',
        posted_date: j.postedDate || j.modified || '',
        url: j.url || `https://jobs.jobvite.com/${o.slug || ''}/job/${j.eId || j.id || ''}`,
      }));
    }
  }
  if (o.slug) {
    const html = await fetchHtml(`https://jobs.jobvite.com/${o.slug}`, 15000);
    if (html) {
      // Pull /job/oNNNN-style links plus visible title
      const re = /<a[^>]+href="(\/[^"]*\/job\/[a-zA-Z0-9]+)"[^>]*>([\s\S]{3,200}?)<\/a>/g;
      const out = []; const seen = new Set();
      let m;
      while ((m = re.exec(html)) !== null) {
        const href = m[1];
        if (seen.has(href)) continue;
        seen.add(href);
        const title = m[2].replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
        if (!title) continue;
        out.push({ title, location: '', posted_date: '', url: `https://jobs.jobvite.com${href}` });
      }
      return out;
    }
  }
  return [];
}

const SCRAPERS = {
  greenhouse:      scrapeGreenhouse,
  lever:           scrapeLever,
  ashby:           scrapeAshby,
  workable:        scrapeWorkable,
  workday:         scrapeWorkday,
  smartrecruiters: scrapeSmartRecruiters,
  icims:           scrapeICIMS,
  jobvite:         scrapeJobvite,
};
const ATS_PRIORITY = { greenhouse: 1, lever: 2, workday: 3, ashby: 4, workable: 5, smartrecruiters: 6, icims: 7, jobvite: 8 };

function csvEsc(s) { if (s == null) return ''; s = String(s); return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
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
    header.forEach((h, i) => row[h] = fields[i] ?? '');
    return row;
  });
}

async function main() {
  const inPath  = path.join(OUT_DIR, 'hospitals_with_ats.csv');
  const outPath = path.join(OUT_DIR, 'jobs_hospitals.csv');

  await mkdir(OUT_DIR, { recursive: true });
  console.log('Reading', inPath);
  const text = await readFile(inPath, 'utf8');
  const hospitals = parseCsv(text)
    .filter(h => h.ats_detected === 'true' && SCRAPERS[h.ats_platform])
    .sort((a, b) => (ATS_PRIORITY[a.ats_platform] || 99) - (ATS_PRIORITY[b.ats_platform] || 99));
  console.log(`${hospitals.length} hospitals with scrapeable ATS (after filter).`);

  const header = 'title,organization,org_type,location,remote,salary,posted_date,url,ats_platform,source_domain,scraped_at,state';
  await writeFile(outPath, header + '\n');

  const limit = pLimit(15);
  const now = new Date().toISOString();
  let total = 0, lastReported = 0;
  const perStateJobs = {};
  const perAtsJobs = {};

  const tasks = hospitals.map(h => limit(async () => {
    const scraper = SCRAPERS[h.ats_platform];
    let jobs = [];
    try { jobs = await scraper(h); }
    catch (e) { console.error(`  ! ${h.name} (${h.ats_platform}) error: ${e.message}`); return; }
    const sw = jobs.filter(j => titleMatches(j.title));
    for (const j of sw) {
      const loc = (j.location || '').toLowerCase();
      const remote = loc.includes('remote') ? 'yes' : (loc.includes('hybrid') ? 'hybrid' : 'no');
      const row = [
        j.title, h.name, 'hospital', j.location, remote, '',
        j.posted_date, j.url, h.ats_platform,
        (() => { try { return new URL(h.website).hostname; } catch { return h.website || ''; } })(),
        now, h.state,
      ].map(csvEsc).join(',');
      await appendFile(outPath, row + '\n');
    }
    total += sw.length;
    perStateJobs[h.state] = (perStateJobs[h.state] || 0) + sw.length;
    perAtsJobs[h.ats_platform] = (perAtsJobs[h.ats_platform] || 0) + sw.length;
    if (sw.length > 0) console.log(`  + ${h.name} (${h.state}, ${h.ats_platform}): ${jobs.length} jobs → ${sw.length} software`);
    if (Math.floor(total / 100) > Math.floor(lastReported / 100)) {
      console.log(`>>> Running hospital count: ${total} software jobs`);
      lastReported = total;
    }
  }));

  await Promise.all(tasks);

  console.log(`\nDONE. ${total} hospital software jobs written to ${outPath}`);
  console.log('\nBy ATS:');
  for (const [k, v] of Object.entries(perAtsJobs).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`);
  console.log('\nBy state:');
  for (const [k, v] of Object.entries(perStateJobs).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(4)} ${v}`);
}

main().catch(e => { console.error(e); process.exit(1); });
