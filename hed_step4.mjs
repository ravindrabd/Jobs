// Step 4: how many HEDjobs titles get rejected by the import KEYWORDS filter?
import { readFileSync } from 'fs';

// Copy-paste of the KEYWORDS list from import.js (must stay in sync)
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
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const KW_RES = KEYWORDS.map(k => new RegExp(`(?:^|[^a-z0-9])${escapeRe(k.toLowerCase())}(?:[^a-z0-9]|$)`, 'i'));
const isSoftware = (t) => !!t && KW_RES.some(r => r.test(t));

function parse(p) {
  const t = readFileSync(p, 'utf8');
  const lines = t.split(/\r?\n/).filter(Boolean);
  const h = lines[0].split(',');
  return lines.slice(1).map(line => {
    const c = []; let cur = '', inQ = false;
    for (let k = 0; k < line.length; k++) {
      const x = line[k];
      if (inQ) {
        if (x === '"' && line[k+1] === '"') { cur += '"'; k++; }
        else if (x === '"') inQ = false;
        else cur += x;
      } else {
        if (x === ',') { c.push(cur); cur = ''; }
        else if (x === '"') inQ = true;
        else cur += x;
      }
    }
    c.push(cur);
    const r = {}; h.forEach((x, i) => r[x] = c[i] || '');
    return r;
  });
}

const rows = parse('jobs_aggregators.csv').filter(r => r.ats_platform === 'higheredjobs');
const accepted = rows.filter(r => isSoftware(r.title));
const rejected = rows.filter(r => !isSoftware(r.title));
console.log('Total HEDjobs scraped:', rows.length);
console.log('Pass KEYWORDS filter:', accepted.length);
console.log('REJECTED by KEYWORDS filter:', rejected.length, `(${Math.round(rejected.length / rows.length * 100)}%)`);
console.log();
console.log('--- 20 rejected titles (would be kept after the HEDjobs filter exemption) ---');
for (const r of rejected.slice(0, 20)) console.log('  -', r.title);
