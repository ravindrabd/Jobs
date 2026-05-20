// Phase 1: Discover universities & NGOs and their ATS platforms
// Output: orgs.csv

import { writeFile, appendFile } from 'fs/promises';
import { existsSync } from 'fs';

process.setMaxListeners(0);

const ATS_PATTERNS = [
  { name: 'workday',        regex: /myworkdayjobs\.com|wd[0-9]+\.myworkdaysite\.com/i },
  { name: 'greenhouse',     regex: /boards\.greenhouse\.io|job-boards\.greenhouse\.io|greenhouse\.io\/(?:embed|jobs)/i },
  { name: 'lever',          regex: /jobs\.lever\.co/i },
  { name: 'ashby',          regex: /jobs\.ashbyhq\.com|ashbyhq\.com/i },
  { name: 'workable',       regex: /apply\.workable\.com/i },
  { name: 'bamboohr',       regex: /bamboohr\.com/i },
  { name: 'taleo',          regex: /taleo\.net/i },
  { name: 'pageup',         regex: /pageuppeople\.com/i },
  { name: 'successfactors', regex: /successfactors\.com/i },
  { name: 'peoplesoft',     regex: /peoplesoft|psoft/i },
  { name: 'icims',          regex: /icims\.com/i },
  { name: 'smartrecruiters',regex: /smartrecruiters\.com/i },
  { name: 'jobvite',        regex: /jobvite\.com/i },
  { name: 'neogov',         regex: /governmentjobs\.com|neogov\.com/i },
];

const CAREER_PATHS = ['/careers', '/jobs', '/employment', '/hr/careers', '/work-with-us', '/join-us', '/about/careers'];

const NGOS = [
  // Civic / open / tech
  ['Electronic Frontier Foundation', 'eff.org'],
  ['Mozilla Foundation', 'foundation.mozilla.org'],
  ['Wikimedia Foundation', 'wikimediafoundation.org'],
  ['Code for America', 'codeforamerica.org'],
  ['Ushahidi', 'ushahidi.com'],
  ['Dimagi', 'dimagi.com'],
  ['Ona', 'ona.io'],
  ['Development Seed', 'developmentseed.org'],
  ['Azavea', 'azavea.com'],
  ['ThoughtWorks', 'thoughtworks.com'],
  ['Internet Archive', 'archive.org'],
  ['Creative Commons', 'creativecommons.org'],
  ['Open Knowledge Foundation', 'okfn.org'],
  ['NTEN', 'nten.org'],
  ['Aspiration Tech', 'aspirationtech.org'],
  ['Linux Foundation', 'linuxfoundation.org'],
  ['Apache Software Foundation', 'apache.org'],
  ['Python Software Foundation', 'python.org'],
  ['Eclipse Foundation', 'eclipse.org'],
  ['OpenSSF', 'openssf.org'],
  ['OWASP', 'owasp.org'],
  ['CNCF', 'cncf.io'],
  ['NumFOCUS', 'numfocus.org'],
  ['Software in the Public Interest', 'spi-inc.org'],
  ['Software Freedom Conservancy', 'sfconservancy.org'],
  ['Open Source Initiative', 'opensource.org'],
  // Health & humanitarian
  ['American Red Cross', 'redcross.org'],
  ['UNICEF', 'unicef.org'],
  ['Gates Foundation', 'gatesfoundation.org'],
  ['Doctors Without Borders', 'doctorswithoutborders.org'],
  ['IntraHealth', 'intrahealth.org'],
  ['FHI 360', 'fhi360.org'],
  ['CARE', 'care.org'],
  ['Habitat for Humanity', 'habitat.org'],
  ['Save the Children', 'savethechildren.org'],
  ['Oxfam America', 'oxfamamerica.org'],
  ['Mercy Corps', 'mercycorps.org'],
  ['Heifer International', 'heifer.org'],
  ['PATH', 'path.org'],
  ['Partners in Health', 'pih.org'],
  ['Carter Center', 'cartercenter.org'],
  ['Resolve to Save Lives', 'resolvetosavelives.org'],
  ['CDC Foundation', 'cdcfoundation.org'],
  ['March of Dimes', 'marchofdimes.org'],
  ['Susan G. Komen', 'komen.org'],
  ['American Heart Association', 'heart.org'],
  ['American Cancer Society', 'cancer.org'],
  ['ALS Association', 'als.org'],
  ['Catholic Relief Services', 'crs.org'],
  ['World Vision', 'worldvision.org'],
  ['Direct Relief', 'directrelief.org'],
  ['Last Mile Health', 'lastmilehealth.org'],
  // Environment
  ['World Wildlife Fund', 'worldwildlife.org'],
  ['The Nature Conservancy', 'nature.org'],
  ['Conservation International', 'conservation.org'],
  ['Environmental Defense Fund', 'edf.org'],
  ['Natural Resources Defense Council', 'nrdc.org'],
  ['Rainforest Alliance', 'rainforest-alliance.org'],
  ['Greenpeace USA', 'greenpeace.org'],
  ['Sierra Club', 'sierraclub.org'],
  ['National Wildlife Federation', 'nwf.org'],
  ['National Audubon Society', 'audubon.org'],
  ['Earthjustice', 'earthjustice.org'],
  ['Defenders of Wildlife', 'defenders.org'],
  ['Ocean Conservancy', 'oceanconservancy.org'],
  ['Rocky Mountain Institute', 'rmi.org'],
  ['World Resources Institute', 'wri.org'],
  ['Climateworks', 'climateworks.org'],
  ['Clean Air Task Force', 'catf.us'],
  ['Energy Foundation', 'ef.org'],
  ['Trust for Public Land', 'tpl.org'],
  // Civil rights / advocacy
  ['Amnesty International', 'amnesty.org'],
  ['Human Rights Watch', 'hrw.org'],
  ['Planned Parenthood', 'plannedparenthood.org'],
  ['ACLU', 'aclu.org'],
  ['Southern Poverty Law Center', 'splcenter.org'],
  ['NAACP', 'naacp.org'],
  ['Anti-Defamation League', 'adl.org'],
  ['Center for Reproductive Rights', 'reproductiverights.org'],
  ['Human Rights First', 'humanrightsfirst.org'],
  ['Brennan Center for Justice', 'brennancenter.org'],
  ['Center for Democracy and Technology', 'cdt.org'],
  ['Center for American Progress', 'americanprogress.org'],
  // Journalism / media
  ['NPR', 'npr.org'],
  ['ProPublica', 'propublica.org'],
  ['OpenSecrets', 'opensecrets.org'],
  ['Center for Investigative Reporting', 'revealnews.org'],
  ['International Consortium of Investigative Journalists', 'icij.org'],
  ['The Marshall Project', 'themarshallproject.org'],
  ['PBS', 'pbs.org'],
  ['Public Broadcasting Service', 'cpb.org'],
  ['Documenting COVID', 'documentingcovid19.io'],
  // Foundations / philanthropy
  ['Ford Foundation', 'fordfoundation.org'],
  ['Rockefeller Foundation', 'rockefellerfoundation.org'],
  ['Hewlett Foundation', 'hewlett.org'],
  ['MacArthur Foundation', 'macfound.org'],
  ['Open Society Foundations', 'opensocietyfoundations.org'],
  ['Bloomberg Philanthropies', 'bloomberg.org'],
  ['Knight Foundation', 'knightfoundation.org'],
  ['Carnegie Corporation', 'carnegie.org'],
  ['Pew Research Center', 'pewresearch.org'],
  ['Pew Charitable Trusts', 'pewtrusts.org'],
  ['W.K. Kellogg Foundation', 'wkkf.org'],
  ['Robert Wood Johnson Foundation', 'rwjf.org'],
  ['Annie E. Casey Foundation', 'aecf.org'],
  ['Mott Foundation', 'mott.org'],
  ['Walton Family Foundation', 'waltonfamilyfoundation.org'],
  // Research / think-tanks
  ['Brookings Institution', 'brookings.edu'],
  ['RAND Corporation', 'rand.org'],
  ['Urban Institute', 'urban.org'],
  ['Council on Foreign Relations', 'cfr.org'],
  ['Heritage Foundation', 'heritage.org'],
  ['Cato Institute', 'cato.org'],
  ['American Enterprise Institute', 'aei.org'],
  ['Brookings', 'brookings.edu'],
  ['Allen Institute', 'alleninstitute.org'],
  ['Allen Institute for AI', 'allenai.org'],
  ['Santa Fe Institute', 'santafe.edu'],
  ['SRI International', 'sri.com'],
  ['RTI International', 'rti.org'],
  // International development & multilateral
  ['Palladium', 'thepalladiumgroup.com'],
  ['Chemonics', 'chemonics.com'],
  ['DAI', 'dai.com'],
  ['Abt Associates', 'abtassociates.com'],
  ['Mathematica', 'mathematica.org'],
  ['Westat', 'westat.com'],
  ['World Bank Group', 'worldbank.org'],
  ['UNDP', 'undp.org'],
  ['IFC', 'ifc.org'],
  ['Inter-American Development Bank', 'iadb.org'],
  // Education / education-tech (nonprofit)
  ['Khan Academy', 'khanacademy.org'],
  ['DonorsChoose', 'donorschoose.org'],
  ['Coursera', 'coursera.org'],
  ['edX', 'edx.org'],
  ['Code.org', 'code.org'],
  ['Citizen Schools', 'citizenschools.org'],
  ['Edutopia', 'edutopia.org'],
  // Social services / community
  ['United Way', 'unitedway.org'],
  ['Goodwill', 'goodwill.org'],
  ['Boys & Girls Clubs of America', 'bgca.org'],
  ['Big Brothers Big Sisters of America', 'bbbs.org'],
  ['Feeding America', 'feedingamerica.org'],
  ['Catholic Charities USA', 'catholiccharitiesusa.org'],
  ['Jewish Federations of North America', 'jewishfederations.org'],
  ['YMCA', 'ymca.net'],
  ['Boy Scouts of America', 'scouting.org'],
  // Veterans
  ['Wounded Warrior Project', 'woundedwarriorproject.org'],
  ['Disabled American Veterans', 'dav.org'],
  // Arts / culture
  ['Smithsonian', 'si.edu'],
  ['Metropolitan Museum of Art', 'metmuseum.org'],
  ['American Museum of Natural History', 'amnh.org'],
];

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

async function fetchWithTimeout(url, ms = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; JobScout/1.0)' },
    });
  } finally { clearTimeout(t); }
}

function detectATS(finalUrl, html) {
  const hay = (finalUrl || '') + '\n' + (html || '').slice(0, 60000);
  for (const p of ATS_PATTERNS) if (p.regex.test(hay)) return p.name;
  return 'custom';
}

function extractDetails(ats, finalUrl, html) {
  const hay = (finalUrl || '') + ' ' + (html || '').slice(0, 100000);
  switch (ats) {
    case 'workday': {
      // Modern: {tenant}.wd{N}.myworkdayjobs.com/[en-US/]{site}
      let m = hay.match(/([a-z][a-z0-9_-]*)\.wd([0-9]+)\.myworkdayjobs\.com\/(?:en-US\/)?([a-zA-Z0-9_-]+)/i);
      if (m) return { tenant: m[1], site: m[3], wd_prefix: 'wd' + m[2] };
      // Older: {tenant}.myworkdayjobs.com/[en-US/]{site}  (exclude wd{N} false matches)
      m = hay.match(/([a-z][a-z0-9_-]*)\.myworkdayjobs\.com\/(?:en-US\/)?([a-zA-Z0-9_-]+)/i);
      if (m && !/^wd[0-9]+$/i.test(m[1])) return { tenant: m[1], site: m[2] };
      // Alt: wd{N}.myworkdaysite.com/recruiting/{tenant}/{site}
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
    case 'lever': {
      const m = hay.match(/jobs\.lever\.co\/([a-z0-9_-]+)/i);
      if (m) return { slug: m[1] };
      return {};
    }
    case 'ashby': {
      const m = hay.match(/jobs\.ashbyhq\.com\/([a-z0-9_-]+)/i);
      if (m) return { slug: m[1] };
      return {};
    }
    case 'workable': {
      const m = hay.match(/apply\.workable\.com\/([a-z0-9_-]+)/i);
      if (m) return { slug: m[1] };
      return {};
    }
    case 'bamboohr': {
      const m = hay.match(/([a-z0-9_-]+)\.bamboohr\.com/i);
      if (m) return { slug: m[1] };
      return {};
    }
    case 'smartrecruiters': {
      const m = hay.match(/smartrecruiters\.com\/([a-z0-9_-]+)/i);
      if (m) return { slug: m[1] };
      return {};
    }
    default: return {};
  }
}

async function probeOrg(name, domain, orgType) {
  for (const path of CAREER_PATHS) {
    const url = `https://${domain}${path}`;
    try {
      const r = await fetchWithTimeout(url, 7000);
      if (!r.ok) continue;
      const finalUrl = r.url;
      const html = await r.text();
      const ats = detectATS(finalUrl, html);
      if (ats === 'neogov') return null;
      if (ats !== 'custom') {
        const d = extractDetails(ats, finalUrl, html);
        return { name, domain, org_type: orgType, ats_platform: ats, careers_url: finalUrl, ...d };
      }
    } catch { /* timeout / DNS / other — try next path */ }
  }
  return null;
}

function csvEsc(s) {
  if (s == null) return '';
  s = String(s);
  return /[,"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  const cap = parseInt(process.env.CAP || '99999', 10);
  console.log('Fetching universities JSON...');
  const r = await fetch('https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json');
  const all = await r.json();
  const us = all.filter(u => u.country === 'United States' && u.domains && u.domains.length);
  console.log(`Found ${us.length} US universities (probing first ${Math.min(cap, us.length)})`);

  // NGOs first so we know they're processed regardless of how long unis take
  const orgs = [
    ...NGOS.map(([n, d]) => ({ name: n, domain: d, org_type: 'ngo' })),
    ...us.slice(0, cap).map(u => ({ name: u.name, domain: u.domains[0], org_type: 'university' })),
  ];

  const limit = pLimit(50);
  const header = 'name,domain,org_type,ats_platform,careers_url,tenant,site,slug,wd_prefix,country';
  await writeFile('orgs.csv', header + '\n');

  let done = 0, found = 0;
  const dist = {};
  const tasks = orgs.map(o => limit(async () => {
    const res = await probeOrg(o.name, o.domain, o.org_type);
    done++;
    if (res) {
      found++;
      dist[res.ats_platform] = (dist[res.ats_platform] || 0) + 1;
      const row = [res.name, res.domain, res.org_type, res.ats_platform, res.careers_url,
        res.tenant || '', res.site || '', res.slug || '', res.wd_prefix || '', 'United States']
        .map(csvEsc).join(',');
      await appendFile('orgs.csv', row + '\n');
    }
    if (done % 25 === 0 || done === orgs.length) console.log(`[${done}/${orgs.length}] found ${found} ATS-detected`);
  }));

  await Promise.all(tasks);

  console.log(`\nDONE-MARKER. orgs.csv has ${found} ATS-detected orgs.\n`);
  console.log('ATS distribution:');
  for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
