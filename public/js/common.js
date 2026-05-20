// Shared client utilities + nav + dark mode + reminder banner.

// --- Dark mode persistence ---
(function initTheme() {
  const stored = localStorage.getItem('theme');
  if (stored === 'dark' || (!stored && window.matchMedia?.('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const btn = document.querySelector('.theme-toggle');
  if (btn) btn.textContent = next === 'dark' ? '☀ Light' : '☾ Dark';
}

// --- Time-ago helper ---
function timeAgo(dateStr) {
  if (!dateStr) return '';
  // Handle "Posted X Days Ago" Workday strings as-is
  if (/posted\s+/i.test(dateStr)) return dateStr.replace(/^posted\s+/i, '');
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return dateStr;
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return days + ' days ago';
  if (days < 365) return Math.floor(days / 30) + ' months ago';
  return Math.floor(days / 365) + ' years ago';
}

// Universal posted-age formatter. Takes a YYYY-MM-DD string (or anything Date.parse can handle).
// Returns { label, ageClass, fullDate } — render <span class="age ${ageClass}" title="${fullDate}">${label}</span>.
function formatPostedAge(iso, kind = 'Posted') {
  if (!iso) return { label: 'Date unknown', ageClass: 'posted-unknown', fullDate: '' };
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { label: 'Date unknown', ageClass: 'posted-unknown', fullDate: iso };
  const days = Math.floor((Date.now() - t) / 86400000);
  const full = new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  let label, ageClass;
  if (days <= 0)        { label = `${kind} today`;           ageClass = 'posted-today'; }
  else if (days === 1)  { label = `${kind} yesterday`;       ageClass = 'posted-today'; }
  else if (days <= 7)   { label = `${kind} ${days} days ago`; ageClass = 'posted-recent'; }
  else if (days <= 13)  { label = `${kind} ${days} days ago`; ageClass = 'posted-recent'; }
  else if (days <= 29)  { label = `${kind} ${Math.floor(days/7)} weeks ago`; ageClass = 'posted-week'; }
  else if (days <= 59)  { label = `${kind} 1 month ago`;     ageClass = 'posted-old'; }
  else if (days <= 89)  { label = `${kind} 2 months ago`;    ageClass = 'posted-old'; }
  else                  { label = `${kind} 3+ months ago`;   ageClass = 'posted-very-old'; }
  return { label, ageClass, fullDate: `${kind}: ${full}` };
}

function ageBadge(iso, kind = 'Posted') {
  const a = formatPostedAge(iso, kind);
  const title = a.fullDate ? ` title="${a.fullDate}"` : '';
  return `<span class="age ${a.ageClass}"${title}>${a.label}</span>`;
}

// --- Number formatting ---
function fmtNum(n) { return (n ?? 0).toLocaleString(); }

// --- Fetch JSON helper ---
async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function jpost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function jput(url, body) {
  const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function jdel(url) {
  const r = await fetch(url, { method: 'DELETE' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// --- Reminder banner (loaded on every page) ---
async function loadReminders() {
  try {
    const d = await jget('/api/dashboard');
    const banner = document.getElementById('reminder-banner');
    if (!banner) return;
    if (d.remindersDue && d.remindersDue.length) {
      banner.innerHTML =
        `⏰ <strong>${d.remindersDue.length} follow-up${d.remindersDue.length === 1 ? '' : 's'} due today.</strong> ` +
        d.remindersDue.slice(0, 5).map(r => `<a href="${r.url}" target="_blank">${escapeHtml(r.title)} @ ${escapeHtml(r.organization)}</a>`).join(' · ');
      banner.classList.add('show');
    }
    const ls = document.getElementById('last-scraped');
    if (ls && d.lastScraped) ls.textContent = 'Last scraped: ' + new Date(d.lastScraped).toLocaleString();
  } catch { /* fine — endpoint might be down */ }
}

function escapeHtml(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}

// --- Modal helpers ---
function showModal(html) {
  const bg = document.getElementById('modal-bg');
  bg.querySelector('.modal').innerHTML = html;
  bg.classList.add('show');
  bg.onclick = (e) => { if (e.target === bg) hideModal(); };
}
function hideModal() {
  document.getElementById('modal-bg').classList.remove('show');
}

document.addEventListener('DOMContentLoaded', () => {
  // Initial label on theme toggle
  const btn = document.querySelector('.theme-toggle');
  if (btn) btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀ Light' : '☾ Dark';
  loadReminders();
});
