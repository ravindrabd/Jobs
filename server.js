// Personal Job Tracker — Express + SQLite (better-sqlite3)
// Auto-imports jobs.csv into jobs.db on first run.

console.log("NODE VERSION:", process.version);
console.log("PORT:", process.env.PORT);
console.log("DB_PATH:", process.env.DB_PATH);
console.log("VOLUME:", process.env.RAILWAY_VOLUME_MOUNT_PATH);

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const multer = require('multer');
const cron = require('node-cron');
const Database = require('better-sqlite3');
const { runImport, ensureSchema } = require('./import.js');
const { parseResume, parseJob } = require('./skills.js');
const { scoreOne } = require('./match.js');
const { fetchJdText } = require('./jd_fetch.js');
const { findMatches: matchAgainstJd_hardcoded } = require('./my_skills.js');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const PORT = parseInt(process.env.PORT, 10) || 3001;
// Persistent volume on Railway, local file otherwise.
const DB_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'jobs.db')
  : (process.env.DB_PATH || path.join(__dirname, 'jobs.db'));
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- First-run import ---
// Make sure the parent dir exists (Railway volume mount or local dir).
try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
} catch (err) {
  console.error('[init] Could not ensure DB directory:', err.message);
}

let dbExisted = fs.existsSync(DB_PATH);
if (!dbExisted) {
  console.log('[init] jobs.db not found — running first-time import…');
  try {
    runImport(DB_PATH);
  } catch (err) {
    console.error('Import failed:', err.message);
    console.log('Starting with empty/existing DB');
  }
}

const db = new Database(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
ensureSchema(db);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR));

// ---------- helpers ----------
function todayIso() { return new Date().toISOString().slice(0, 10); }
function rowToJob(r) {
  if (!r) return null;
  return { ...r, applied: r.app_status ? { id: r.app_id, status: r.app_status, applied_date: r.applied_date, follow_up_date: r.follow_up_date, notes: r.notes } : null };
}

// ---------- /api/jobs ----------
app.get('/api/jobs', (req, res) => {
  const {
    q = '', org_type = 'all', remote = 'all', posted_within = 'all',
    ats_platform = 'all', status = 'all', sort = 'newest',
    page = '1', limit = '50',
  } = req.query;

  const where = ['j.removed = 0', 'j.show_flag = 1']; const params = {};
  if (q.trim()) { where.push('(LOWER(j.title) LIKE @q OR LOWER(j.organization) LIKE @q)'); params.q = '%' + q.toLowerCase() + '%'; }

  if (org_type === 'low_competition') { where.push("j.competition_level = 'low'"); }
  else if (org_type !== 'all' && org_type !== 'other') { where.push('j.org_type = @org_type'); params.org_type = org_type; }
  else if (org_type === 'other') { where.push("j.org_type NOT IN ('university','ngo','hospital')"); }

  if (remote !== 'all') { where.push('j.remote = @remote'); params.remote = remote; }

  if (posted_within !== 'all') {
    const days = { today: 0, fresh: 2, '3': 3, '7': 7, '30': 30 }[posted_within];
    if (days != null) {
      where.push("j.posted_date_iso IS NOT NULL AND j.posted_date_iso >= DATE('now', '-' || @days || ' days')");
      params.days = String(days);
    }
  }

  if (ats_platform !== 'all') {
    if (ats_platform === 'other') {
      where.push("j.ats_platform NOT IN ('workday','greenhouse','lever','icims','jobvite')");
    } else {
      where.push('j.ats_platform = @ats_platform');
      params.ats_platform = ats_platform;
    }
  }

  // Multi-source filter (used by the Universities tab). Accepts a comma-separated list of:
  //   higheredjobs, chronicle, us-rse, idealist, direct
  // where "direct" = anything not in the aggregator set.
  if (req.query.source) {
    const sources = String(req.query.source).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const AGGREGATORS = ['higheredjobs','chronicle','us-rse','idealist','himss'];
    const wantAggs = sources.filter(s => AGGREGATORS.includes(s));
    const wantDirect = sources.includes('direct');
    const clauses = [];
    if (wantAggs.length) clauses.push(`j.ats_platform IN (${wantAggs.map(s => `'${s}'`).join(',')})`);
    if (wantDirect)     clauses.push(`j.ats_platform NOT IN (${AGGREGATORS.map(s => `'${s}'`).join(',')})`);
    if (clauses.length) where.push('(' + clauses.join(' OR ') + ')');
  }

  if (status === 'not_applied') where.push('a.id IS NULL');
  else if (status === 'saved') where.push("a.status = 'saved'");
  else if (status === 'applied') where.push("a.status IN ('applied','interview','offer','rejected')");

  const orderBy = sort === 'oldest' ? "COALESCE(j.posted_date_iso, '9999') ASC, j.id ASC"
                : sort === 'org' ? 'j.organization COLLATE NOCASE ASC, j.id ASC'
                : sort === 'match' ? 'COALESCE(j.match_score, -1) DESC, j.id DESC'
                : sort === 'relevance' ? `(
                    COALESCE(j.match_score, 0) +
                    CASE
                      WHEN j.posted_date_iso IS NULL THEN 0
                      WHEN julianday('now') - julianday(j.posted_date_iso) <= 7  THEN 30
                      WHEN julianday('now') - julianday(j.posted_date_iso) <= 30 THEN 15
                      WHEN julianday('now') - julianday(j.posted_date_iso) <= 90 THEN 5
                      ELSE 0
                    END
                  ) DESC, j.id DESC`
                : "COALESCE(j.posted_date_iso, '0000') DESC, j.id DESC";

  // Match filters (only meaningful when a resume is loaded)
  if (req.query.min_match) {
    where.push('COALESCE(j.match_score, 0) >= @min_match');
    params.min_match = parseInt(req.query.min_match, 10);
  }
  if (req.query.min_skills) {
    const n = parseInt(req.query.min_skills, 10);
    // matched_skills stored as JSON array; count via SQL json_array_length
    where.push(`COALESCE(json_array_length(j.matched_skills), 0) >= ${n}`);
  }

  const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
  const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10));
  const lim = Math.min(200, Math.max(1, parseInt(limit, 10)));

  const sql = `
    SELECT j.*, a.id AS app_id, a.status AS app_status, a.applied_date, a.follow_up_date, a.notes
    FROM jobs j
    LEFT JOIN applications a ON a.job_id = j.id
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT @lim OFFSET @offset
  `;
  const countSql = `SELECT COUNT(*) AS n FROM jobs j LEFT JOIN applications a ON a.job_id = j.id ${whereSql}`;
  try {
    const rows = db.prepare(sql).all({ ...params, lim, offset });
    const total = db.prepare(countSql).get(params).n;
    res.json({ total, page: parseInt(page, 10), limit: lim, jobs: rows.map(rowToJob) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Soft-delete (Remove / Restore) — registered BEFORE /api/jobs/:id ----------
app.get('/api/jobs/removed', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, title, organization, org_type, location, remote, ats_platform,
           source_domain, posted_date, posted_date_iso, url, removed_at,
           match_score, match_label, matched_skills, missing_skills
    FROM jobs WHERE removed = 1
    ORDER BY datetime(removed_at) DESC, id DESC
  `).all();
  res.json({ total: rows.length, jobs: rows });
});
app.post('/api/jobs/:id/remove', (req, res) => {
  const info = db.prepare(`UPDATE jobs SET removed = 1, removed_at = datetime('now') WHERE id = ? AND removed = 0`).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not_found_or_already_removed' });
  res.json({ removed: 1 });
});
app.post('/api/jobs/:id/restore', (req, res) => {
  const info = db.prepare(`UPDATE jobs SET removed = 0, removed_at = NULL WHERE id = ? AND removed = 1`).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not_found_or_not_removed' });
  res.json({ restored: 1 });
});

// On-click JD fetch — pulls the full JD page text, caches it, recomputes match against the resume.
app.post('/api/jobs/:id/fetch-jd', async (req, res) => {
  const j = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!j) return res.status(404).json({ error: 'not_found' });
  // Return cached if we already have it (and the resume hasn't changed since)
  if (j.jd_text && j.jd_text.length > 50 && !req.query.force) {
    return res.json({ cached: true, jd_text_preview: j.jd_text.slice(0, 800), match: { score: j.match_score, label: j.match_label, matched_skills: JSON.parse(j.matched_skills||'[]'), missing_skills: JSON.parse(j.missing_skills||'[]') } });
  }
  try {
    const text = await fetchJdText(j.url);
    if (!text) return res.status(502).json({ error: 'fetch_failed' });
    // Use the hardcoded MY_SKILLS + alias map (single-user app).
    const m = matchAgainstJd_hardcoded(text);
    const showFlag = m.matched.length >= 1 ? 1 : 0;
    db.prepare(`UPDATE jobs SET jd_text = ?, jd_fetched_at = datetime('now'),
                                matched_skills = ?, missing_skills = ?, match_score = ?,
                                show_flag = ? WHERE id = ?`)
      .run(text, JSON.stringify(m.matched), JSON.stringify(m.missing), m.score, showFlag, j.id);
    res.json({ cached: false, jd_text_preview: text.slice(0, 800),
               match: { matched_skills: m.matched, missing_skills: m.missing, score: m.score },
               show_flag: showFlag });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const r = db.prepare(`
    SELECT j.*, a.id AS app_id, a.status AS app_status, a.applied_date, a.follow_up_date, a.notes
    FROM jobs j LEFT JOIN applications a ON a.job_id = j.id WHERE j.id = ?
  `).get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  res.json(rowToJob(r));
});

// ---------- /api/dashboard ----------
app.get('/api/dashboard', (req, res) => {
  const counts = {
    universities:      db.prepare("SELECT COUNT(*) n FROM jobs WHERE removed = 0 AND org_type='university'").get().n,
    ngos:              db.prepare("SELECT COUNT(*) n FROM jobs WHERE removed = 0 AND org_type='ngo'").get().n,
    hospitals:         db.prepare("SELECT COUNT(*) n FROM jobs WHERE removed = 0 AND org_type='hospital'").get().n,
    low_competition:   db.prepare("SELECT COUNT(*) n FROM jobs WHERE removed = 0 AND competition_level='low'").get().n,
    other:             db.prepare("SELECT COUNT(*) n FROM jobs WHERE removed = 0 AND org_type NOT IN ('university','ngo','hospital')").get().n,
    total:             db.prepare("SELECT COUNT(*) n FROM jobs WHERE removed = 0").get().n,
    removed:           db.prepare("SELECT COUNT(*) n FROM jobs WHERE removed = 1").get().n,
  };

  // Source breakdown per org_type. Anything not in the aggregator list is "direct".
  const sourceMap = { higheredjobs: 'via HigherEdJobs', chronicle: 'via Chronicle', 'us-rse': 'via us-rse.org', idealist: 'via Idealist', himss: 'via HIMSS JobMine' };
  const rawSources = db.prepare(`SELECT org_type, ats_platform, COUNT(*) n FROM jobs WHERE removed = 0 GROUP BY org_type, ats_platform`).all();
  const sourcesByOrgType = {};
  for (const r of rawSources) {
    const label = sourceMap[r.ats_platform] || 'Direct';
    sourcesByOrgType[r.org_type] = sourcesByOrgType[r.org_type] || {};
    sourcesByOrgType[r.org_type][label] = (sourcesByOrgType[r.org_type][label] || 0) + r.n;
  }
  const statuses = db.prepare(`SELECT status, COUNT(*) n FROM applications GROUP BY status`).all();
  const appStats = { saved: 0, applied: 0, interview: 0, offer: 0, rejected: 0 };
  for (const r of statuses) appStats[r.status] = r.n;

  // Jobs added per day (last 30 days) — use DATE(scraped_at)
  const jobsByDay = db.prepare(`
    SELECT DATE(scraped_at) AS day, COUNT(*) n FROM jobs
    WHERE removed = 0 AND scraped_at IS NOT NULL AND scraped_at != ''
      AND DATE(scraped_at) >= DATE('now','-29 days')
    GROUP BY DATE(scraped_at) ORDER BY day
  `).all();

  // Jobs posted today (uses parsed posted_date_iso)
  const postedToday = db.prepare(`
    SELECT COUNT(*) n FROM jobs WHERE removed = 0 AND posted_date_iso = DATE('now')
  `).get().n;

  // Reminders due today or past (only for non-removed jobs)
  const remindersDue = db.prepare(`
    SELECT a.id, a.job_id, a.follow_up_date, j.title, j.organization, j.url
    FROM applications a JOIN jobs j ON j.id = a.job_id
    WHERE j.removed = 0 AND a.follow_up_date != '' AND DATE(a.follow_up_date) <= DATE('now')
    ORDER BY a.follow_up_date ASC
  `).all();

  const lastScraped = db.prepare(`SELECT MAX(scraped_at) v FROM jobs WHERE removed = 0`).get().v;

  res.json({ counts, sourcesByOrgType, appStats, jobsByDay, postedToday, remindersDue, lastScraped });
});

// ---------- /api/applications ----------
app.get('/api/applications', (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, j.title, j.organization, j.location, j.url, j.ats_platform, j.posted_date, j.org_type
    FROM applications a JOIN jobs j ON j.id = a.job_id
    ORDER BY CASE a.status
      WHEN 'saved' THEN 0 WHEN 'applied' THEN 1 WHEN 'interview' THEN 2
      WHEN 'offer' THEN 3 WHEN 'rejected' THEN 4 END,
      a.updated_at DESC
  `).all();
  res.json({ applications: rows });
});

app.post('/api/applications', (req, res) => {
  const { job_id, status = 'applied', notes = '', follow_up_date = '' } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id required' });
  const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(job_id);
  if (!job) return res.status(404).json({ error: 'job not found' });
  const applied_date = status === 'saved' ? '' : todayIso();
  try {
    const info = db.prepare(`
      INSERT INTO applications (job_id, status, applied_date, follow_up_date, notes, updated_at)
      VALUES (@job_id, @status, @applied_date, @follow_up_date, @notes, datetime('now'))
      ON CONFLICT(job_id) DO UPDATE SET
        status=excluded.status,
        applied_date=CASE WHEN excluded.applied_date='' THEN applications.applied_date ELSE excluded.applied_date END,
        follow_up_date=excluded.follow_up_date,
        notes=excluded.notes,
        updated_at=datetime('now')
    `).run({ job_id, status, applied_date, follow_up_date, notes });
    const app = db.prepare('SELECT * FROM applications WHERE job_id = ?').get(job_id);
    res.json({ application: app });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/applications/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const fields = ['status','applied_date','follow_up_date','notes'];
  const updates = {};
  for (const f of fields) if (f in (req.body || {})) updates[f] = req.body[f];
  if (!Object.keys(updates).length) return res.json({ application: existing });
  if (updates.status && !['saved','applied','interview','offer','rejected'].includes(updates.status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  // If moving from saved → applied (or beyond) and no applied_date, set today.
  if (updates.status && updates.status !== 'saved' && !existing.applied_date && !updates.applied_date) {
    updates.applied_date = todayIso();
  }
  const sets = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE applications SET ${sets}, updated_at=datetime('now') WHERE id = @id`).run({ ...updates, id });
  res.json({ application: db.prepare('SELECT * FROM applications WHERE id = ?').get(id) });
});

app.delete('/api/applications/:id', (req, res) => {
  const info = db.prepare('DELETE FROM applications WHERE id = ?').run(req.params.id);
  res.json({ deleted: info.changes });
});

// ---------- /api/stats ----------
app.get('/api/stats', (req, res) => {
  const byOrgType = db.prepare(`SELECT org_type, COUNT(*) n FROM jobs WHERE removed = 0 GROUP BY org_type ORDER BY n DESC`).all();
  const byAts     = db.prepare(`SELECT ats_platform, COUNT(*) n FROM jobs WHERE removed = 0 GROUP BY ats_platform ORDER BY n DESC`).all();
  const bySource  = db.prepare(`SELECT source_domain, COUNT(*) n FROM jobs WHERE removed = 0 GROUP BY source_domain ORDER BY n DESC LIMIT 20`).all();
  const byState   = db.prepare(`
    SELECT COALESCE(UPPER(NULLIF(SUBSTR(location, INSTR(location, ', ')+2, 2),'')),'??') AS state, COUNT(*) n
    FROM jobs WHERE removed = 0 AND location LIKE '%, __%' GROUP BY state ORDER BY n DESC LIMIT 60
  `).all();
  const appsByStatus = db.prepare(`SELECT status, COUNT(*) n FROM applications GROUP BY status`).all();
  const total = db.prepare('SELECT COUNT(*) n FROM jobs WHERE removed = 0').get().n;
  const totalApps = db.prepare('SELECT COUNT(*) n FROM applications').get().n;
  const applied = db.prepare(`SELECT COUNT(*) n FROM applications WHERE status IN ('applied','interview','offer','rejected')`).get().n;
  const interviews = db.prepare(`SELECT COUNT(*) n FROM applications WHERE status IN ('interview','offer','rejected')`).get().n;
  const offers = db.prepare(`SELECT COUNT(*) n FROM applications WHERE status IN ('offer')`).get().n;
  const responseRate = applied ? +(interviews / applied * 100).toFixed(1) : 0;
  res.json({
    total, totalApps,
    byOrgType, byAts, bySource, byState, appsByStatus,
    funnel: { applied, interviews, offers, responseRate },
  });
});

// ---------- /api/resume ----------
function getResume() {
  const row = db.prepare('SELECT id, raw_text, resume_parsed, uploaded_at FROM resume WHERE id = 1').get();
  if (!row) return null;
  try { row.parsed = JSON.parse(row.resume_parsed); } catch { row.parsed = null; }
  return row;
}

function saveResume(rawText) {
  const parsed = parseResume(rawText);
  db.prepare(`
    INSERT INTO resume (id, raw_text, resume_parsed, uploaded_at)
    VALUES (1, @raw_text, @parsed, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      raw_text=excluded.raw_text,
      resume_parsed=excluded.resume_parsed,
      uploaded_at=excluded.uploaded_at
  `).run({ raw_text: rawText, parsed: JSON.stringify(parsed) });
  return parsed;
}

function recomputeAllMatches() {
  const resume = getResume();
  if (!resume) return { updated: 0, withMatches: 0 };
  const parsed = resume.parsed;
  const jobs = db.prepare('SELECT id, title, organization, org_type, location, remote, ats_platform FROM jobs WHERE removed = 0').all();
  const upd = db.prepare('UPDATE jobs SET match_score=?, match_label=?, matched_skills=?, missing_skills=? WHERE id=?');
  let updated = 0, withMatches = 0;
  db.exec('BEGIN');
  try {
    for (const j of jobs) {
      const jp = parseJob(j);
      const s = scoreOne(jp, parsed, j);
      upd.run(s.score, s.label, JSON.stringify(s.matched_skills), JSON.stringify(s.missing_skills), j.id);
      updated++;
      if (s.matched_skills.length > 0) withMatches++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { updated, withMatches };
}

app.get('/api/resume', (req, res) => {
  const r = getResume();
  if (!r) return res.json({ resume: null });
  res.json({ resume: { uploaded_at: r.uploaded_at, parsed: r.parsed, raw_text_preview: r.raw_text.slice(0, 800) } });
});

// PDF upload OR text paste. Single endpoint, accepts multipart (file=resume.pdf) or JSON {text}.
app.post('/api/resume/upload', upload.single('file'), async (req, res) => {
  try {
    let rawText = (req.body && req.body.text) ? String(req.body.text) : '';
    if (req.file && req.file.buffer) {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: req.file.buffer });
      const data = await parser.getText();
      try { await parser.destroy?.(); } catch {}
      rawText = String(data?.text || '').trim();
    }
    if (!rawText || rawText.length < 30) {
      return res.status(400).json({ error: 'no_text', message: 'No text could be parsed from the upload.' });
    }
    const parsed = saveResume(rawText);
    const result = recomputeAllMatches();
    res.json({ parsed, matchSummary: result });
  } catch (e) {
    res.status(500).json({ error: 'parse_failed', message: e.message });
  }
});

app.post('/api/resume/match-all', (_req, res) => {
  try { res.json(recomputeAllMatches()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/jobs/:id/match', (req, res) => {
  const j = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!j) return res.status(404).json({ error: 'not_found' });
  const resume = getResume();
  if (!resume) return res.status(400).json({ error: 'no_resume', message: 'Upload a resume first.' });
  const jp = parseJob(j);
  const s = scoreOne(jp, resume.parsed, j);
  res.json({ job: j, jd_parsed: jp, resume_parsed: resume.parsed, ...s });
});

// Local "tailor resume" → no LLM. Returns a structured checklist:
//   keywords_to_add: every JD-detected skill missing from resume
//   bullets_to_emphasize: existing resume skills that the JD also wants (highlight these)
//   adjacent_keywords: skills the resume already has that fall in the same family as missing ones
app.post('/api/jobs/:id/tailor', (req, res) => {
  const j = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!j) return res.status(404).json({ error: 'not_found' });
  const resume = getResume();
  if (!resume) return res.status(400).json({ error: 'no_resume' });
  const jp = parseJob(j);
  const s = scoreOne(jp, resume.parsed, j);
  res.json({
    job_title: j.title,
    organization: j.organization,
    keywords_to_add: s.missing_skills,
    bullets_to_emphasize: s.matched_skills,
    breakdown: s.breakdown,
    score: s.score,
  });
});

// ---------- /api/import (re-import after scraper re-runs) ----------
app.post('/api/import', (req, res) => {
  try {
    const result = runImport();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manual scrape trigger (declared early so it's not shadowed by /api/* 404).
app.post('/api/scrape', (_req, res) => {
  runCronScrape('manual');
  res.json({ ok: true, started: !scrapeRunning ? false : true });
});

// Health check — used by Railway and the in-browser "last updated" indicator.
app.get('/api/health', (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) n FROM jobs WHERE removed=0').get().n;
  const showing = db.prepare('SELECT COUNT(*) n FROM jobs WHERE removed=0 AND show_flag=1').get().n;
  const lastScrapeRow = db.prepare("SELECT value FROM kv WHERE key='last_scrape_at'").get();
  res.json({
    status: 'ok',
    jobs: total,
    showing,
    lastScrape: lastScrapeRow?.value || null,
    uptime: Math.round(process.uptime()),
  });
});

// Default landing page
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// 404 for unknown API paths
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// ---- Scheduled scrape (every 3 hours by default, configurable via SCRAPE_CRON) ----
let scrapeRunning = false;
function runCronScrape(trigger = 'cron') {
  if (scrapeRunning) { console.log('[scrape] already running — skipping'); return; }
  scrapeRunning = true;
  console.log(`[scrape] starting (${trigger})`);
  const child = spawn(process.execPath, ['cron_scrape.mjs'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, DB_PATH },
  });
  child.on('exit', (code) => {
    scrapeRunning = false;
    console.log(`[scrape] finished (exit ${code})`);
  });
}
// (The /api/scrape POST handler is declared earlier, before the /api 404 catch-all.)
const SCRAPE_CRON = process.env.SCRAPE_CRON || '0 */3 * * *'; // every 3 hours
if (process.env.DISABLE_CRON !== '1') {
  cron.schedule(SCRAPE_CRON, () => runCronScrape('cron'));
  console.log(`[init] scheduler armed: ${SCRAPE_CRON}`);
}

const loadedCount = db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT} — ${loadedCount} jobs loaded`);
});
