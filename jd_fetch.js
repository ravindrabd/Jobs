// Universal JD-page fetcher + skill matcher against resume jd_text.
//
// fetchJdText(url) → returns plain text (HTML stripped) or null
//   - higheredjobs.com URLs use Playwright (the detail pages are JS-rendered)
//   - Everything else uses plain fetch + cheerio strip-tags
//
// matchAgainstJd(jdText, resumeParsed) → returns { matched, missing, score }
//   - Uses SKILL_ALIASES from skills.js
//   - For each canonical resume skill, checks if any of its aliases
//     appears as a case-insensitive substring of the JD text
//   - Match % = matched.length / resume_skills.length * 100

const { SKILL_ALIASES, ALIAS_DISPLAY, extractSkills } = require('./skills.js');
let _browser = null;
let _ctx = null;

async function getBrowser() {
  if (_browser) return _browser;
  const { chromium } = await import('playwright');
  _browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  _ctx = await _browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  await _ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  return _browser;
}

async function closeBrowser() {
  if (_browser) { try { await _browser.close(); } catch {} _browser = null; _ctx = null; }
}

async function fetchHtmlPlaywright(url, timeoutMs = 30000) {
  await getBrowser();
  const page = await _ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    // Brief wait for any post-load XHR
    await page.waitForTimeout(2000);
    return await page.content();
  } catch { return null; }
  finally { try { await page.close(); } catch {} }
}

async function fetchHtmlPlain(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal, redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
  finally { clearTimeout(t); }
}

// Strip tags + collapse whitespace; remove scripts/styles first.
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Routes the right fetcher based on URL.
async function fetchJdText(url) {
  if (!url) return null;
  let html;
  // Sites that 403 plain Node fetch (TLS-fingerprint sniffing) → use Playwright.
  if (/higheredjobs\.com|jobmine\.himss\.org|careerassist\.ahima\.org/i.test(url)) {
    html = await fetchHtmlPlaywright(url, 30000);
  } else {
    html = await fetchHtmlPlain(url, 15000);
    // Fallback to Playwright if plain returned nothing (some sites have bot challenges)
    if (!html) html = await fetchHtmlPlaywright(url, 30000);
  }
  if (!html) return null;
  return htmlToText(html).slice(0, 30000); // cap at 30k chars (avoid bloating DB)
}

// Match resume skills (from parsed resume json) against jd_text using SKILL_ALIASES.
// Returns { matched_skills: [...], missing_skills: [...], score }
function matchAgainstJd(jdText, resumeParsed) {
  if (!jdText) return { matched_skills: [], missing_skills: [], score: 0 };
  const t = String(jdText).toLowerCase();
  const resumeSkills = (resumeParsed?.skills || []);
  // Build a per-skill alias list. Use SKILL_ALIASES if defined for that canonical,
  // otherwise just the skill itself (case-insensitive substring).
  const matched = [];
  const missing = [];
  for (const s of resumeSkills) {
    const sLower = String(s).toLowerCase();
    // Find the alias-map canonical that corresponds to this display name.
    let aliases = null;
    for (const [canonical, aliasList] of Object.entries(SKILL_ALIASES)) {
      const display = (ALIAS_DISPLAY[canonical] || canonical).toLowerCase();
      if (display === sLower) { aliases = aliasList; break; }
    }
    if (!aliases) aliases = [sLower];
    // Check if ANY alias appears in the JD text as a whole word.
    const hit = aliases.some(a => {
      const al = String(a).toLowerCase();
      const re = new RegExp(`(?:^|[^a-z0-9])${al.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`, 'i');
      return re.test(t);
    });
    if (hit) matched.push(s); else missing.push(s);
  }
  // Match % = matched_skills / total_skills_found_in_JD * 100 (per earlier rule).
  // If the JD mentions no skills at all, fall back to 0.
  const jdSkillSet = new Set(extractSkills(jdText).map(s => s.toLowerCase()));
  const totalJdSkills = jdSkillSet.size;
  const score = totalJdSkills ? Math.round((matched.length / totalJdSkills) * 100) : 0;
  return { matched_skills: matched, missing_skills: missing, score };
}

module.exports = { fetchJdText, matchAgainstJd, htmlToText, closeBrowser };
