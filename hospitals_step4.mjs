// Hospital Step 4: Merge hospital jobs into jobs.csv with dedup.
// Reads jobs.csv (existing) + out/jobs_hospitals.csv, deduplicates,
// appends new hospital rows to jobs.csv, prints final summary tables.

import { readFile, writeFile, appendFile } from 'fs/promises';
import path from 'path';

const OUT_DIR = 'out';

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { header: [], rows: [] };
  const header = lines[0].split(',');
  const rows = lines.slice(1).map(line => {
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
  return { header, rows };
}

function csvEsc(s) { if (s == null) return ''; s = String(s); return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function normalize(s) { return (s || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(); }
function key(r) { return `${normalize(r.title)}|${normalize(r.organization)}|${normalize(r.location)}`; }

async function main() {
  const jobsPath = 'jobs.csv';
  const hospitalsPath = path.join(OUT_DIR, 'jobs_hospitals.csv');

  console.log('Reading existing jobs.csv...');
  const jobsRaw = await readFile(jobsPath, 'utf8');
  const { header: jobsHeader, rows: jobsRows } = parseCsv(jobsRaw);
  console.log(`  ${jobsRows.length} existing jobs`);

  console.log('Reading hospital jobs...');
  let hospRaw = '';
  try { hospRaw = await readFile(hospitalsPath, 'utf8'); }
  catch { console.log('  (no jobs_hospitals.csv found — nothing to merge)'); return; }
  const { header: hospHeader, rows: hospRows } = parseCsv(hospRaw);
  console.log(`  ${hospRows.length} hospital jobs`);

  // Build dedup index from existing jobs
  const seen = new Set(jobsRows.map(key));

  // Append new hospital rows that don't collide
  let appended = 0, dupes = 0;
  const newRowStrings = [];
  for (const h of hospRows) {
    if (seen.has(key(h))) { dupes++; continue; }
    seen.add(key(h));
    // Re-emit using jobsHeader column order, dropping any extra columns (e.g., state)
    const row = jobsHeader.map(c => csvEsc(h[c] ?? '')).join(',');
    newRowStrings.push(row);
    appended++;
  }

  if (newRowStrings.length) {
    await appendFile(jobsPath, newRowStrings.join('\n') + '\n');
  }

  const finalCount = jobsRows.length + appended;

  // Per-state breakdown
  const perStateHospitalsJobs = {};
  for (const h of hospRows) perStateHospitalsJobs[h.state] = (perStateHospitalsJobs[h.state] || 0) + 1;

  // For per-state hospitals + ATS detected, read hospitals_with_ats.csv
  let perStateHospitals = {}, perStateAtsDetected = {};
  try {
    const text = await readFile(path.join(OUT_DIR, 'hospitals_with_ats.csv'), 'utf8');
    const { rows } = parseCsv(text);
    for (const r of rows) {
      const st = r.state;
      perStateHospitals[st] = (perStateHospitals[st] || 0) + 1;
      if (r.ats_detected === 'true') perStateAtsDetected[st] = (perStateAtsDetected[st] || 0) + 1;
    }
  } catch { /* fine */ }

  // -- Summary --
  console.log('\n========================================');
  console.log('FINAL HOSPITAL PIPELINE SUMMARY');
  console.log('========================================');
  console.log(`Total hospitals in hospitals.csv:       ${Object.values(perStateHospitals).reduce((a,b)=>a+b,0)}`);
  console.log(`Hospitals with ATS detected:            ${Object.values(perStateAtsDetected).reduce((a,b)=>a+b,0)}`);
  console.log(`Hospitals scraped (had software jobs):  ${Object.keys(perStateHospitalsJobs).reduce((acc, st) => acc + (perStateHospitalsJobs[st] > 0 ? 1 : 0), 0)}`); // rough proxy
  console.log(`Raw hospital software jobs found:       ${hospRows.length}`);
  console.log(`After dedup with existing jobs.csv:     ${appended} new   (${dupes} duplicates dropped)`);
  console.log(`Final jobs.csv total:                   ${finalCount}`);

  console.log('\nPer-state breakdown (state | hospitals | ats_detected | software jobs added):');
  const states = Array.from(new Set([...Object.keys(perStateHospitals), ...Object.keys(perStateHospitalsJobs)])).sort();
  for (const st of states) {
    const h = perStateHospitals[st] || 0;
    const a = perStateAtsDetected[st] || 0;
    const j = perStateHospitalsJobs[st] || 0;
    console.log(`  ${(st || '?').padEnd(4)} ${String(h).padStart(5)}  ${String(a).padStart(5)}  ${String(j).padStart(6)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
