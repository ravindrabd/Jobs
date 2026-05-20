// Hospital Step 1: Build hospitals.csv from CMS (authoritative list) + OSM (websites).
// CMS gives us the canonical list of Medicare-certified US hospitals.
// OSM Overpass gives us website tags for many of those hospitals.
// We match by (state, normalized facility_name overlap) — hospitals without an OSM
// website are written with website="" and source="cms" (will be skipped in Step 2).

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

process.setMaxListeners(0);

const OUT_DIR = 'out';
const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC','PR',
];

const UA = 'JobScout/1.0 (research; contact: claude-code job-scraper)';

async function fetchJson(url, opts = {}, ms = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: 'application/json', ...(opts.headers || {}) },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
  finally { clearTimeout(t); }
}

// ---------- CMS: paginate all hospitals ----------
async function fetchAllCmsHospitals() {
  const all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const url = `https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0?limit=${limit}&offset=${offset}`;
    const data = await fetchJson(url);
    if (!data || !Array.isArray(data.results)) break;
    all.push(...data.results);
    console.log(`  CMS: fetched ${all.length} so far (offset ${offset})`);
    if (data.results.length < limit) break;
    offset += limit;
    if (offset > 50000) break; // safety
  }
  return all;
}

// ---------- OSM Overpass: hospitals with website tags by state ----------
async function fetchOsmHospitalsForState(stateCode) {
  const q = `[out:json][timeout:60];
area["ISO3166-2"="US-${stateCode}"][admin_level=4]->.s;
(
  node["amenity"="hospital"]["website"](area.s);
  way["amenity"="hospital"]["website"](area.s);
  relation["amenity"="hospital"]["website"](area.s);
);
out tags;`;
  const url = 'https://overpass-api.de/api/interpreter';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.elements || []).map(e => ({
      name: e.tags?.name || '',
      website: e.tags?.website || '',
      city:  e.tags?.['addr:city'] || '',
      street: e.tags?.['addr:street'] || '',
      housenumber: e.tags?.['addr:housenumber'] || '',
      zip:   e.tags?.['addr:postcode'] || '',
      stateTag: e.tags?.['addr:state'] || '',
      operator: e.tags?.operator || '',
      healthcare_speciality: e.tags?.['healthcare:speciality'] || '',
      beds: e.tags?.beds || '',
    })).filter(o => o.name && o.website);
  } catch { return []; }
  finally { clearTimeout(t); }
}

// ---------- Name normalization for matching ----------
const STOPWORDS = new Set([
  'the','inc','llc','of','at','and','&','co','corp','dept','department',
  'hospital','hospitals','medical','centre','center','centers','centres',
  'health','healthcare','system','systems','clinic','services',
]);

function normTokens(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(t => t && t.length >= 3 && !STOPWORDS.has(t));
}

// Match CMS facility to OSM facility by overlapping significant tokens AND same state.
function buildOsmIndex(osmByState) {
  // index: stateCode -> array of { tokens:Set, raw }
  const idx = {};
  for (const [state, list] of Object.entries(osmByState)) {
    idx[state] = list.map(o => ({ tokens: new Set(normTokens(o.name)), raw: o }));
  }
  return idx;
}

function findOsmMatch(cmsName, stateCode, idx) {
  const list = idx[stateCode];
  if (!list) return null;
  const cmsTokens = new Set(normTokens(cmsName));
  if (!cmsTokens.size) return null;
  let best = null, bestScore = 0;
  for (const cand of list) {
    let shared = 0;
    for (const t of cmsTokens) if (cand.tokens.has(t)) shared++;
    if (shared === 0) continue;
    const union = cmsTokens.size + cand.tokens.size - shared;
    const jaccard = shared / union;
    // Require at least 2 shared tokens for multi-token CMS names, or
    // 1 shared token if either side has only 1 significant token.
    const minShared = (cmsTokens.size === 1 || cand.tokens.size === 1) ? 1 : 2;
    if (shared < minShared) continue;
    if (jaccard > bestScore) { bestScore = jaccard; best = cand.raw; }
  }
  // Require Jaccard ≥ 0.3 to avoid wild matches
  return bestScore >= 0.3 ? best : null;
}

// ---------- CSV ----------
function csvEsc(s) {
  if (s == null) return '';
  s = String(s);
  return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  console.log('Step 1: Building hospitals.csv from CMS + OSM');
  console.log('Fetching CMS Hospital General Information...');
  const cms = await fetchAllCmsHospitals();
  console.log(`CMS total: ${cms.length} hospitals\n`);

  console.log('Fetching OSM hospitals with website tags (per state, polite 1.2s pacing)...');
  const osmByState = {};
  for (const st of STATES) {
    const list = await fetchOsmHospitalsForState(st);
    osmByState[st] = list;
    console.log(`  OSM ${st}: ${list.length} hospitals with website`);
    await new Promise(r => setTimeout(r, 1200));
  }

  const idx = buildOsmIndex(osmByState);

  // Merge: for each CMS hospital, try to find OSM match
  console.log('\nMatching CMS facilities to OSM website tags...');
  const merged = [];
  const perStateCount = {};
  const perStateWithWebsite = {};
  for (const h of cms) {
    const state = (h.state || '').toUpperCase();
    perStateCount[state] = (perStateCount[state] || 0) + 1;
    const osm = findOsmMatch(h.facility_name, state, idx);
    if (osm) perStateWithWebsite[state] = (perStateWithWebsite[state] || 0) + 1;
    merged.push({
      name: h.facility_name,
      address: h.address,
      city: h.citytown,
      state,
      zip: h.zip_code,
      website: osm?.website || '',
      hospital_type: h.hospital_type,
      hospital_ownership: h.hospital_ownership,
      telephone: h.telephone_number,
      source: osm ? 'cms+osm' : 'cms',
    });
  }

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, 'hospitals.csv');
  const header = 'name,address,city,state,zip,website,hospital_type,hospital_ownership,telephone,source';
  const rows = merged.map(h => [h.name,h.address,h.city,h.state,h.zip,h.website,h.hospital_type,h.hospital_ownership,h.telephone,h.source].map(csvEsc).join(','));
  await writeFile(outPath, [header, ...rows].join('\n') + '\n');

  // Per-state summary
  console.log('\nPer-state counts (state | cms | with-website):');
  let withWebsiteTotal = 0;
  const shortStates = [];
  for (const st of STATES) {
    const c = perStateCount[st] || 0;
    const w = perStateWithWebsite[st] || 0;
    withWebsiteTotal += w;
    const flag = c < 100 ? '  ⚠ <100' : '';
    console.log(`  ${st}  ${String(c).padStart(4)}  ${String(w).padStart(4)}${flag}`);
    if (c < 100) shortStates.push(st);
  }
  console.log(`\nTotal CMS hospitals:           ${cms.length}`);
  console.log(`Total with OSM website match:  ${withWebsiteTotal}`);
  console.log(`States with < 100 CMS hospitals (per your rule, not back-filled): ${shortStates.join(', ') || 'none'}`);
  console.log(`Wrote ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
