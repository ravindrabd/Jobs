// Hospital Step 2: ATS detection per hospital.
// Reads out/hospitals.csv, probes career URLs on each hospital website,
// detects ATS using the same patterns as phase1 + adds Oracle HCM + iCIMS/Jobvite tenant extraction.
// Writes out/hospitals_with_ats.csv.

import { readFile, writeFile, mkdir, appendFile } from 'fs/promises';
import path from 'path';

process.setMaxListeners(0);
// Don't let an unhandled rejection take the whole sweep down.
process.on('unhandledRejection', (e) => { console.error('UNHANDLED:', e?.message || e); });
process.on('uncaughtException',  (e) => { console.error('UNCAUGHT:',  e?.message || e); });

const OUT_DIR = 'out';

const ATS_PATTERNS = [
  { name: 'workday',        regex: /myworkdayjobs\.com|wd[0-9]+\.myworkdaysite\.com/i },
  { name: 'greenhouse',     regex: /boards\.greenhouse\.io|job-boards\.greenhouse\.io|greenhouse\.io\/(?:embed|jobs)/i },
  { name: 'lever',          regex: /jobs\.lever\.co/i },
  { name: 'ashby',          regex: /jobs\.ashbyhq\.com|ashbyhq\.com/i },
  { name: 'workable',       regex: /apply\.workable\.com/i },
  { name: 'bamboohr',       regex: /bamboohr\.com/i },
  { name: 'taleo',          regex: /taleo\.net/i },
  { name: 'pageup',         regex: /pageuppeople\.com/i },
  { name: 'successfactors', regex: /successfactors\.com|sfsf|sap\.com\/careers/i },
  { name: 'peoplesoft',     regex: /peoplesoft|psoft/i },
  { name: 'icims',          regex: /icims\.com/i },
  { name: 'smartrecruiters',regex: /smartrecruiters\.com/i },
  { name: 'jobvite',        regex: /jobvite\.com/i },
  { name: 'oracle_hcm',     regex: /oraclecloud\.com\/(?:talent|hcm)|fa-(?:em|ev|us)[a-z0-9-]+\.oraclecloud\.com|oraclecloud\.com\/hcmUI/i },
  // New patterns common in healthcare
  { name: 'hirebridge',     regex: /hirebridge\.com/i },
  { name: 'paylocity',      regex: /recruiting\.paylocity\.com|paylocity\.com\/recruiting/i },
  { name: 'ukg',            regex: /(?:recruiting|us\d*)\.ultipro\.com|ukg\.com\/careers|kronos\.com\/careers/i },
  { name: 'infor',          regex: /infor\.com\/talent|lawson\.com|gtnxt\.com/i },
  { name: 'meditech',       regex: /careers\.meditech\.com/i },
  { name: 'silkroad',       regex: /silkroad\.com|openhire\.silkroad\.com/i },
  { name: 'adp',            regex: /workforcenow\.adp\.com/i },
  { name: 'neogov',         regex: /governmentjobs\.com|neogov\.com/i },
];

// Smaller, higher-signal set to keep the 3,665-hospital sweep under 15 min.
const CAREER_PATHS = ['/careers', '/jobs', '/careers/search', '/about/careers', '/employment'];

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

async function fetchWithTimeout(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA },
    });
  } finally { clearTimeout(t); }
}

function detectATS(finalUrl, html) {
  const hay = (finalUrl || '') + '\n' + (html || '').slice(0, 60000);
  for (const p of ATS_PATTERNS) if (p.regex.test(hay)) return p.name;
  return null;
}

function extractDetails(ats, finalUrl, html) {
  const hay = (finalUrl || '') + ' ' + (html || '').slice(0, 100000);
  switch (ats) {
    case 'workday': {
      let m = hay.match(/([a-z][a-z0-9_-]*)\.wd([0-9]+)\.myworkdayjobs\.com\/(?:en-US\/)?([a-zA-Z0-9_-]+)/i);
      if (m) return { tenant: m[1], site: m[3], wd_prefix: 'wd' + m[2] };
      m = hay.match(/([a-z][a-z0-9_-]*)\.myworkdayjobs\.com\/(?:en-US\/)?([a-zA-Z0-9_-]+)/i);
      if (m && !/^wd[0-9]+$/i.test(m[1])) return { tenant: m[1], site: m[2] };
      m = hay.match(/wd([0-9]+)\.myworkdaysite\.com\/(?:recruiting\/)?([a-z0-9_-]+)\/([a-zA-Z0-9_-]+)/i);
      if (m) return { tenant: m[2], site: m[3], wd_prefix: 'wd' + m[1] };
      return {};
    }
    case 'greenhouse': {
      let m = hay.match(/(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i);
      if (m) return { slug: m[1] };
      m = hay.match(/greenhouse\.io\/embed\/job_board\?for=([a-z0-9_-]+)/i);
      if (m) return { slug: m[1] };
      return {};
    }
    case 'lever':           { const m = hay.match(/jobs\.lever\.co\/([a-z0-9_-]+)/i); return m ? { slug: m[1] } : {}; }
    case 'ashby':           { const m = hay.match(/jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i); return m ? { slug: m[1] } : {}; }
    case 'workable':        { const m = hay.match(/apply\.workable\.com\/([a-z0-9_-]+)/i); return m ? { slug: m[1] } : {}; }
    case 'bamboohr':        { const m = hay.match(/([a-z0-9_-]+)\.bamboohr\.com/i); return m ? { slug: m[1] } : {}; }
    case 'smartrecruiters': { const m = hay.match(/smartrecruiters\.com\/([a-z0-9_-]+)/i); return m ? { slug: m[1] } : {}; }
    case 'icims': {
      // careers-{tenant}.icims.com  OR  {tenant}.icims.com
      let m = hay.match(/careers-([a-z0-9_-]+)\.icims\.com/i);
      if (m) return { tenant: m[1] };
      m = hay.match(/([a-z0-9_-]+)\.icims\.com/i);
      if (m) return { tenant: m[1] };
      return {};
    }
    case 'jobvite': {
      // jobs.jobvite.com/{company}  OR  /careers/{companyId}
      let m = hay.match(/jobs\.jobvite\.com\/(?:careers\/)?([a-z0-9_-]+)/i);
      if (m) return { slug: m[1] };
      m = hay.match(/jobvite\.com\/companyJobs[^"']*c=([A-Za-z0-9]+)/i);
      if (m) return { company_id: m[1] };
      return {};
    }
    case 'oracle_hcm': {
      const m = hay.match(/(fa-[a-z]{2,3}[a-z0-9-]+)\.oraclecloud\.com/i);
      if (m) return { tenant: m[1] };
      return {};
    }
    default: return {};
  }
}

async function probeHospital(h) {
  if (!h.website) return { ats_detected: false, reason: 'no_website' };
  // Normalize website: strip path, keep scheme+host
  let base = h.website.trim();
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
  // First try the homepage to detect ATS embedded in homepage
  // Then probe career paths.
  const tried = new Set();
  const urls = [];
  try {
    const u = new URL(base);
    const origin = u.origin;
    urls.push(base); // exact website URL as-is
    for (const p of CAREER_PATHS) urls.push(origin + p);
  } catch { return { ats_detected: false, reason: 'bad_website' }; }

  for (const url of urls) {
    if (tried.has(url)) continue;
    tried.add(url);
    try {
      const r = await fetchWithTimeout(url, 6000);
      if (!r.ok) continue;
      const finalUrl = r.url;
      const html = await r.text();
      const ats = detectATS(finalUrl, html);
      if (ats === 'neogov') return { ats_detected: false, reason: 'neogov_skipped' };
      if (ats) {
        const d = extractDetails(ats, finalUrl, html);
        return { ats_detected: true, ats_platform: ats, careers_url: finalUrl, ...d };
      }
    } catch { /* timeout / DNS / TLS — try next */ }
  }
  return { ats_detected: false, reason: 'no_ats_detected' };
}

// CSV
function csvEsc(s) {
  if (s == null) return '';
  s = String(s);
  return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

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
  const inPath = path.join(OUT_DIR, 'hospitals.csv');
  const outPath = path.join(OUT_DIR, 'hospitals_with_ats.csv');
  console.log('Reading', inPath);
  const text = await readFile(inPath, 'utf8');
  const hospitals = parseCsv(text);
  const withWebsite = hospitals.filter(h => (h.website || '').trim());
  console.log(`Loaded ${hospitals.length} hospitals (${withWebsite.length} with website).`);

  const outHeader = 'name,address,city,state,zip,website,hospital_type,hospital_ownership,telephone,source,careers_url,ats_platform,ats_detected,tenant,site,slug,wd_prefix,company_id,skip_reason';
  await writeFile(outPath, outHeader + '\n');

  const limit = pLimit(30);
  let done = 0, detected = 0;
  const perStateDetected = {};
  const distribution = {};

  // Retry the file append a few times if OneDrive locks the file briefly.
  async function safeAppend(line) {
    for (let i = 0; i < 5; i++) {
      try { return await appendFile(outPath, line); }
      catch (e) {
        if (i === 4 || !['EBUSY','EPERM','EACCES'].includes(e.code)) throw e;
        await new Promise(r => setTimeout(r, 300 * (i+1)));
      }
    }
  }

  const tasks = hospitals.map(h => limit(async () => {
    let result;
    try { result = await probeHospital(h); }
    catch (e) { result = { ats_detected: false, reason: 'probe_error:' + (e?.message || 'unknown') }; }
    done++;
    if (result.ats_detected) {
      detected++;
      perStateDetected[h.state] = (perStateDetected[h.state] || 0) + 1;
      distribution[result.ats_platform] = (distribution[result.ats_platform] || 0) + 1;
    }
    const row = [
      h.name, h.address, h.city, h.state, h.zip, h.website,
      h.hospital_type, h.hospital_ownership, h.telephone, h.source,
      result.careers_url || '', result.ats_platform || '',
      result.ats_detected ? 'true' : 'false',
      result.tenant || '', result.site || '', result.slug || '',
      result.wd_prefix || '', result.company_id || '',
      result.reason || '',
    ].map(csvEsc).join(',');
    try { await safeAppend(row + '\n'); }
    catch (e) { console.error('  WRITE FAIL @', h.name, ':', e.message); }
    if (done % 100 === 0) console.log(`[${done}/${hospitals.length}] ${detected} ATS-detected so far`);
  }));

  await Promise.all(tasks);

  console.log(`\nDONE. ${detected} of ${hospitals.length} hospitals have a detected ATS.`);
  console.log('\nATS distribution (hospitals):');
  for (const [k, v] of Object.entries(distribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }

  console.log('\nPer-state ATS-detected:');
  const states = Array.from(new Set(hospitals.map(h => h.state))).sort();
  for (const st of states) {
    console.log(`  ${st}  ${perStateDetected[st] || 0}`);
  }

  console.log(`\nWrote ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
