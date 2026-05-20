// Import jobs.csv into jobs.db (SQLite via better-sqlite3).
// Idempotent: upserts by (title + organization + location), so re-running merges new rows.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'jobs.db');
const CSV_PATH = path.join(__dirname, 'jobs.csv');

// --- CSV parser (handles quoted fields, escaped quotes) ---
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { header: [], rows: [] };
  const header = parseRow(lines[0]);
  const rows = lines.slice(1).map(line => {
    const fields = parseRow(line);
    const row = {};
    header.forEach((h, i) => row[h] = fields[i] ?? '');
    return row;
  });
  return { header, rows };
}
function parseRow(line) {
  const fields = []; let cur = '', inQ = false;
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
  return fields;
}

// --- Schema ---
function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      organization TEXT,
      org_type TEXT,
      location TEXT,
      remote TEXT,
      salary TEXT,
      posted_date TEXT,
      url TEXT UNIQUE,           -- canonical identity: same URL = same job
      ats_platform TEXT,
      source_domain TEXT,
      scraped_at TEXT,
      competition_level TEXT,
      dedup_key TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_org_type     ON jobs(org_type);
    CREATE INDEX IF NOT EXISTS idx_jobs_remote       ON jobs(remote);
    CREATE INDEX IF NOT EXISTS idx_jobs_posted_date  ON jobs(posted_date);
    CREATE INDEX IF NOT EXISTS idx_jobs_competition  ON jobs(competition_level);
    CREATE INDEX IF NOT EXISTS idx_jobs_ats_platform ON jobs(ats_platform);

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('saved','applied','interview','offer','rejected')),
      applied_date TEXT,
      follow_up_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(job_id)
    );
    CREATE INDEX IF NOT EXISTS idx_apps_status        ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_apps_follow_up     ON applications(follow_up_date);

    CREATE TABLE IF NOT EXISTS resume (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      raw_text TEXT NOT NULL,
      resume_parsed TEXT NOT NULL,
      uploaded_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Idempotent ALTER TABLE: add columns if they don't exist yet.
  const cols = db.prepare("PRAGMA table_info(jobs)").all().map(r => r.name);
  if (!cols.includes('match_score'))     db.exec('ALTER TABLE jobs ADD COLUMN match_score INTEGER');
  if (!cols.includes('matched_skills'))  db.exec('ALTER TABLE jobs ADD COLUMN matched_skills TEXT');
  if (!cols.includes('missing_skills'))  db.exec('ALTER TABLE jobs ADD COLUMN missing_skills TEXT');
  if (!cols.includes('match_label'))     db.exec('ALTER TABLE jobs ADD COLUMN match_label TEXT');
  if (!cols.includes('posted_date_iso')) db.exec('ALTER TABLE jobs ADD COLUMN posted_date_iso TEXT');
  if (!cols.includes('removed'))         db.exec('ALTER TABLE jobs ADD COLUMN removed INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('removed_at'))      db.exec('ALTER TABLE jobs ADD COLUMN removed_at TEXT');
  if (!cols.includes('jd_text'))         db.exec('ALTER TABLE jobs ADD COLUMN jd_text TEXT');
  if (!cols.includes('show_flag'))       db.exec('ALTER TABLE jobs ADD COLUMN show_flag INTEGER NOT NULL DEFAULT 1');
  if (!cols.includes('jd_fetched_at'))   db.exec('ALTER TABLE jobs ADD COLUMN jd_fetched_at TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_match_score ON jobs(match_score)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_posted_iso  ON jobs(posted_date_iso)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_removed     ON jobs(removed)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_show_flag   ON jobs(show_flag)');
}

// Parse a posted-date string from any of our sources into YYYY-MM-DD.
// Returns null when the input is unparseable.
function parsePostedDateIso(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Direct ISO/RFC 2822 timestamp
  let d = Date.parse(s);
  if (!Number.isNaN(d)) return new Date(d).toISOString().slice(0, 10);
  // "Posted today" / "Posted yesterday"
  if (/posted\s+today/i.test(s)) {
    return new Date().toISOString().slice(0, 10);
  }
  if (/posted\s+yesterday/i.test(s)) {
    const dt = new Date(); dt.setDate(dt.getDate() - 1);
    return dt.toISOString().slice(0, 10);
  }
  // "Posted N Days Ago" / "Posted 30+ Days Ago"
  let m = s.match(/posted\s+(\d+)\+?\s+days?\s+ago/i);
  if (m) {
    const dt = new Date(); dt.setDate(dt.getDate() - parseInt(m[1], 10));
    return dt.toISOString().slice(0, 10);
  }
  m = s.match(/posted\s+(\d+)\+?\s+months?\s+ago/i);
  if (m) {
    const dt = new Date(); dt.setMonth(dt.getMonth() - parseInt(m[1], 10));
    return dt.toISOString().slice(0, 10);
  }
  // "Posted: May 15, 2026"  or "May 15, 2026"
  d = Date.parse(s.replace(/^posted:?\s*/i, ''));
  if (!Number.isNaN(d)) return new Date(d).toISOString().slice(0, 10);
  return null;
}

// --- Helpers ---
function norm(s) { return (s || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(); }
function dedupKey(r) { return `${norm(r.title)}|${norm(r.organization)}|${norm(r.location)}`; }

// Word-boundary KEYWORDS filter — defense in depth, in case jobs.csv contains noise.
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
  // Clinical / health informatics — common at hospitals
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
function isSoftwareTitle(title) {
  if (!title) return false;
  return KW_RES.some(re => re.test(title));
}

// Top-50 US universities (kept compact — same set as phase3.mjs).
const TOP_50_UNIS = new Set([
  'massachusetts institute of technology','mit','harvard university','stanford university',
  'princeton university','yale university','columbia university','university of pennsylvania',
  'california institute of technology','caltech','duke university','university of chicago',
  'johns hopkins university','northwestern university','dartmouth college','brown university',
  'cornell university','vanderbilt university','rice university','washington university in st. louis',
  'university of notre dame','emory university','georgetown university','carnegie mellon university',
  'university of california, berkeley','university of california, los angeles','ucla','uc berkeley',
  'university of michigan','university of virginia','university of north carolina at chapel hill',
  'new york university','nyu','university of southern california','usc',
  'university of florida','university of texas at austin','university of wisconsin-madison',
  'georgia institute of technology','georgia tech','university of illinois urbana-champaign',
  'boston college','boston university','tufts university','university of california, san diego',
  'university of california, davis','university of california, irvine','university of california, santa barbara',
  'purdue university','pennsylvania state university','penn state','ohio state university',
  'university of washington','university of maryland','rutgers university','university of minnesota',
]);
const FAANG_TIER = new Set([
  'google','meta','facebook','amazon','apple','microsoft','netflix','stripe','airbnb','uber',
  'lyft','tesla','spacex','openai','anthropic','palantir','databricks','snowflake','salesforce',
  'oracle','ibm','nvidia',
]);

function daysSince(dateStr) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

function scoreCompetition(j) {
  const orgLower = (j.organization || '').toLowerCase();
  const ats = (j.ats_platform || '').toLowerCase();
  const days = daysSince(j.posted_date);
  if (FAANG_TIER.has(orgLower)) return 'high';
  if (j.org_type === 'university' && TOP_50_UNIS.has(orgLower)) return 'high';
  if (days !== null && days < 3 && (ats === 'greenhouse' || ats === 'lever')) return 'high';
  if (j.org_type === 'university' && !TOP_50_UNIS.has(orgLower)) return 'low';
  if (j.org_type === 'ngo') return 'low';
  if (j.org_type === 'hospital') return 'low';
  if (j.org_type === 'small_org') return 'low';
  if (days !== null && days > 14) return 'low';
  if (ats === 'workday' || ats === 'taleo') return 'low';
  return 'medium';
}

// --- Main import ---
function importCsv(db, csvPath) {
  if (!fs.existsSync(csvPath)) {
    console.log(`[import] ${csvPath} not found — nothing to import.`);
    return { inserted: 0, skipped: 0, total: 0 };
  }
  const raw = fs.readFileSync(csvPath, 'utf8');
  const { rows } = parseCsv(raw);
  console.log(`[import] Read ${rows.length} rows from ${path.basename(csvPath)}`);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO jobs
      (title, organization, org_type, location, remote, salary, posted_date, posted_date_iso,
       url, ats_platform, source_domain, scraped_at, competition_level, dedup_key)
    VALUES (@title, @organization, @org_type, @location, @remote, @salary, @posted_date, @posted_date_iso,
            @url, @ats_platform, @source_domain, @scraped_at, @competition_level, @dedup_key)
  `);

  // Backfill posted_date_iso on any existing rows that don't have it yet.
  const stale = db.prepare(`SELECT id, posted_date FROM jobs WHERE posted_date_iso IS NULL AND posted_date IS NOT NULL AND posted_date != ''`).all();
  if (stale.length) {
    const upd = db.prepare(`UPDATE jobs SET posted_date_iso = ? WHERE id = ?`);
    db.exec('BEGIN');
    try {
      for (const row of stale) upd.run(parsePostedDateIso(row.posted_date), row.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    console.log(`[import] Backfilled posted_date_iso on ${stale.length} existing rows.`);
  }

  let inserted = 0, skippedDup = 0, skippedNonSoftware = 0, skippedNoUrl = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      if (!r.title || !r.title.trim()) { skippedNonSoftware++; continue; }
      // HEDjobs gets a pass on the title filter (per the latest rule). Display filters
      // (min_skills ≥ 1 in /api/jobs) handle the noise. Non-HEDjobs sources still filter.
      // HEDjobs + HIMSS are curated healthcare-IT / higher-ed-IT boards — every listing
      // is already a software/IT/informatics role by definition.
      const ats = (r.ats_platform || '').toLowerCase();
      const exempt = ats === 'higheredjobs' || ats === 'himss';
      if (!exempt && !isSoftwareTitle(r.title)) { skippedNonSoftware++; continue; }
      if (!r.url || !r.url.trim()) { skippedNoUrl++; continue; }
      const rec = {
        title: r.title.trim(),
        organization: r.organization || '',
        org_type: r.org_type || '',
        location: r.location || '',
        remote: r.remote || 'no',
        salary: r.salary || '',
        posted_date: r.posted_date || '',
        posted_date_iso: parsePostedDateIso(r.posted_date) || null,
        url: r.url || '',
        ats_platform: r.ats_platform || '',
        source_domain: r.source_domain || '',
        scraped_at: r.scraped_at || new Date().toISOString(),
        competition_level: scoreCompetition(r),
        dedup_key: dedupKey(r),
      };
      const info = insert.run(rec);
      if (info.changes) inserted++; else skippedDup++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const total = db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
  console.log(`[import] Inserted ${inserted} new.`);
  console.log(`[import] Skipped: ${skippedNonSoftware} non-software titles, ${skippedDup} duplicate URLs, ${skippedNoUrl} missing URL.`);
  console.log(`[import] Total in DB: ${total}.`);
  return { inserted, skippedNonSoftware, skippedDup, skippedNoUrl, total };
}

function run() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  ensureSchema(db);
  const result = importCsv(db, CSV_PATH);
  db.close();
  return result;
}

if (require.main === module) {
  run();
}

module.exports = { run, importCsv, ensureSchema, dedupKey, scoreCompetition };
