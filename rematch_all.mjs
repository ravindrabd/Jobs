// Re-match every job in the DB against the hardcoded MY_SKILLS list (with aliases).
// Uses jd_text if present, otherwise falls back to the job title.

import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { findMatches, MY_SKILLS, isBlockedTitle } = require('./my_skills.js');

const db = new DatabaseSync('jobs.db');
db.exec('PRAGMA journal_mode = WAL');

console.log('Hardcoded MY_SKILLS canonicals:', MY_SKILLS.length);

const rows = db.prepare(`SELECT id, title, jd_text FROM jobs WHERE removed = 0`).all();
console.log('Active jobs to re-match:', rows.length);

const upd = db.prepare(`UPDATE jobs SET matched_skills = ?, missing_skills = ?, match_score = ?, show_flag = ? WHERE id = ?`);

let usedJd = 0, usedTitle = 0, shown = 0, hidden = 0, blockedByTitle = 0;
db.exec('BEGIN');
try {
  for (const r of rows) {
    let show;
    let m;
    if (isBlockedTitle(r.title)) {
      // Title blocklist wins regardless of skill match (e.g. "Lecturer in CS").
      m = { matched: [], missing: MY_SKILLS.slice(), score: 0 };
      show = 0; blockedByTitle++;
    } else {
      const blob = r.jd_text || r.title || '';
      if (r.jd_text) usedJd++; else usedTitle++;
      m = findMatches(blob);
      show = m.matched.length >= 1 ? 1 : 0;
    }
    if (show) shown++; else hidden++;
    upd.run(JSON.stringify(m.matched), JSON.stringify(m.missing), m.score, show, r.id);
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK'); throw e;
}

console.log('\n========== REPORT ==========');
console.log('Total active jobs:         ', rows.length);
console.log('Matched using jd_text:     ', usedJd);
console.log('Matched using title only:  ', usedTitle, '(no jd_text yet — on-click will improve)');
console.log('Blocked by title list:     ', blockedByTitle);
console.log('Now showing (≥1 match):    ', shown);
console.log('Hidden (0 matches):        ', hidden);

// Top 10 newly matched jobs across the whole DB
const top = db.prepare(`
  SELECT title, organization, ats_platform, match_score, matched_skills, jd_text IS NOT NULL AS has_jd
  FROM jobs WHERE removed = 0 AND show_flag = 1
  ORDER BY json_array_length(matched_skills) DESC, match_score DESC, id DESC
  LIMIT 10
`).all();
console.log('\n========== TOP 10 MATCHED JOBS ==========');
for (const r of top) {
  const m = JSON.parse(r.matched_skills || '[]');
  console.log(`${String(r.match_score).padStart(3)}% (${m.length} matched) | ${r.title}`);
  console.log(`    @ ${r.organization}  [${r.ats_platform}, ${r.has_jd ? 'JD' : 'title-only'}]`);
  console.log(`    skills: ${m.slice(0, 10).join(', ')}${m.length > 10 ? ' …' : ''}`);
}

db.close();
