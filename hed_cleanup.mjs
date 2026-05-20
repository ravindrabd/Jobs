// Delete HEDjobs rows that don't pass the KEYWORDS filter.
import { readFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';

const text = readFileSync('import.js', 'utf8');
const m = text.match(/const KEYWORDS = \[([\s\S]*?)\];/);
const KEYWORDS = eval('[' + m[1] + ']');
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const KW_RES = KEYWORDS.map(k => new RegExp(`(?:^|[^a-z0-9])${escapeRe(k.toLowerCase())}(?:[^a-z0-9]|$)`, 'i'));
const isSoftware = (t) => !!t && KW_RES.some(r => r.test(t));

const db = new DatabaseSync('jobs.db');
const heds = db.prepare(`SELECT id, title FROM jobs WHERE ats_platform='higheredjobs'`).all();
console.log('HEDjobs in DB before cleanup:', heds.length);
const toDelete = heds.filter(j => !isSoftware(j.title));
console.log('Rows that fail KEYWORDS filter:', toDelete.length);
console.log('Rows that PASS (will keep):', heds.length - toDelete.length);

const del = db.prepare('DELETE FROM jobs WHERE id = ?');
db.exec('BEGIN');
try {
  for (const r of toDelete) del.run(r.id);
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }

const remaining = db.prepare(`SELECT COUNT(*) n FROM jobs WHERE ats_platform='higheredjobs' AND removed=0`).get().n;
const total = db.prepare(`SELECT COUNT(*) n FROM jobs WHERE removed=0`).get().n;
console.log('HEDjobs remaining:', remaining);
console.log('Total active jobs in DB:', total);
db.close();
