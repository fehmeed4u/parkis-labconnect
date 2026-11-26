import { CONFIG } from './config.js';
import { db, session, refresh, isDemo, demoUsers, resetDemo, login, logout, changePassword, TEST_LOGINS } from './store.js';
import { esc } from './logic.js';
import { $, toast, modal, closeModal } from './ui.js';
import * as home from './views/home.js';
import * as order from './views/order.js';
import * as library from './views/library.js';
import * as week from './views/week.js';
import * as requests from './views/requests.js';
import * as prep from './views/prep.js';
import * as inventory from './views/inventory.js';
import * as admin from './views/admin.js';

const ROUTES = { home, order, library, week, requests, prep, inventory, admin };
const NAV = {
  teacher: [['home', 'Home'], ['library', 'Practical library'], ['order', 'Order a practical'], ['requests', 'My requests'], ['inventory', 'Inventory', '(view)']],
  technician: [['requests', 'Request queue'], ['week', 'Week board'], ['inventory', 'Inventory'], ['library', 'Practical library'], ['order', 'Order for a teacher']],
  admin: [['admin', 'Overview'], ['requests', 'Request queue'], ['week', 'Week board'], ['admin/people', 'People & roles'], ['admin/settings', 'Rules & lead times'], ['inventory', 'Inventory & hazards'], ['library', 'Practical library'], ['order', 'Order a practical'], ['admin/data', 'Import & export']]
};
const ROLE_LABEL = { teacher: 'Teacher', technician: 'Lab technician', admin: 'Head of department' };
const THEMES = [['teal', 'Clean teal'], ['cobalt', 'Ink and cobalt'], ['dark', 'Dark prep room']];

export function go(hash) { location.hash = hash; }
const home_ = () => ({ teacher: 'home', technician: 'week', admin: 'admin' }[session.me.role] || 'home');

function applyTheme() {
  let t = 'teal'; try { t = localStorage.getItem('sp_theme_' + (session.me?.email || '')) || 'teal'; } catch (e) {}
  document.documentElement.dataset.theme = t; try { localStorage.setItem('sp_last_theme', t); } catch (e) {}
}

export function themePicker() {
  const cur = document.documentElement.dataset.theme || 'teal';
  return `<div class="themes" role="group" aria-label="Colour scheme">${THEMES.map(([k, l]) => `<button class="sw sw-${k}" data-theme-pick="${k}" aria-pressed="${k === cur}" aria-label="${esc(l)}" title="${esc(l)}"></button>`).join('')}</div>`;
}
export function wireThemes(root = document) {
  root.querySelectorAll('[data-theme-pick]').forEach(b => b.onclick = () => {
    try { localStorage.setItem('sp_theme_' + session.me.email, b.dataset.themePick); } catch (e) {}
    applyTheme(); document.querySelectorAll('[data-theme-pick]').forEach(x => x.setAttribute('aria-pressed', x.dataset.themePick === document.documentElement.dataset.theme));
  });
}

function shell(active) {
  const nav = NAV[session.me.role] || NAV.teacher;
  const top = active.split('/')[0];
  const isOn = k => k === active || (!nav.some(([x]) => x === active) && k === top);
  $('#app').innerHTML = `<div class="shell">
  <aside class="sidebar" id="sidebar">
    <a class="brand" href="#/${home_()}">Practicals</a>
    <button class="icon-btn b menu-btn" id="menu" aria-label="Menu" aria-expanded="false" aria-controls="sidebar">☰</button>
    <nav aria-label="Main">${nav.map(([k, l, s]) => `<a href="#/${k}"${isOn(k) ? ' aria-current="page"' : ''}>${esc(l)}${s ? ` <small>${esc(s)}</small>` : ''}</a>`).join('')}</nav>
    <div class="side-foot">
      <div>Signed in as<br><strong>${esc(session.me.name)}</strong><br>${esc(ROLE_LABEL[session.me.role] || session.me.role)}</div>
      ${themePicker()}
      ${session.me.hasPassword ? '<button class="linkbtn small" id="chpw" style="text-align:left">Change password</button>' : ''}
      <button class="btn small" id="signout">${isDemo() ? 'Switch user' : 'Sign out'}</button>
    </div>
  </aside>
  <div class="main">
    ${isDemo() ? `<div class="demo-bar">Demo mode — data is kept only in this browser. <button class="linkbtn" id="resetDemo">Reset demo data</button></div>` : ''}
    <main id="view" tabindex="-1"></main>
  </div></div>`;
  $('#signout').onclick = async () => { await logout(); saveSession(); go('#/login'); render(); };
  const cp = $('#chpw'); if (cp) cp.onclick = () => passwordDialog();
  const rd = $('#resetDemo'); if (rd) rd.onclick = resetDemo;
  $('#menu').onclick = () => { const o = $('#sidebar').classList.toggle('open'); $('#menu').setAttribute('aria-expanded', o); };
  wireThemes();
}

const saveSession = () => { try { if (session.me) sessionStorage.setItem('sp_session', JSON.stringify(session)); else sessionStorage.removeItem('sp_session'); } catch (e) {} };
const AUTH_ERR = {
  bad_login: 'That username and password don’t match. Check them, or ask the HOD to reset your password.',
  too_many_attempts: 'Too many wrong tries. Wait 10 minutes, or ask the HOD to reset your password.',
  password_too_short: 'Use at least 8 characters.', wrong_current_password: 'Your current password isn’t right.',
  same_password: 'Choose a password that’s different from the temporary one.'
};
const authMsg = e => AUTH_ERR[e.message] || (/not_registered/.test(e.message) ? 'Your account isn’t on the staff list yet. Ask the HOD to add you in People & roles.' : 'Sign-in failed: ' + e.message);

async function loginView() {
  document.documentElement.dataset.theme = 'teal';
  const google = !isDemo() && CONFIG.GOOGLE_CLIENT_ID;
  const demoPick = isDemo() ? (await demoUsers()).filter(u => ['teacher@demo.school', 'tech@demo.school', 'hod@demo.school'].includes(u.email)) : [];
  $('#app').innerHTML = `<main class="login">
    <h1 class="h1">Science Practicals</h1>
    <form id="lf" class="card stack" style="width:min(400px,100%);text-align:left">
      <h2 class="h2">Sign in</h2>
      <label class="fld">Username<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <label class="fld">Password<input name="password" type="password" autocomplete="current-password" required></label>
      <p id="lerr" class="err small" role="alert"></p>
      <button class="btn pri big block">Sign in</button>
      <p class="muted xs">New here? The head of department gives you a username and a temporary password. You choose your own password the first time you sign in.</p>
      ${google ? '<hr><div id="gbtn"></div>' : ''}
    </form>
    ${isDemo() ? `<p class="muted">Demo mode — or try it straight away as:</p>
      <div class="login-cards">${demoPick.map(u => `<button class="card login-card" data-email="${esc(u.email)}"><strong>${esc(u.name)}</strong><span class="muted">${esc({ teacher: 'Teacher', technician: 'Lab technician', admin: 'Head of department (admin)' }[u.role])}</span></button>`).join('')}</div>
      <section class="card stack" style="width:min(640px,100%);text-align:left;gap:8px"><h2 class="h3" style="margin:0">Test sign-ins</h2>
        <table class="tbl"><thead><tr><th>Role</th><th>Username</th><th>Password</th><th></th></tr></thead><tbody>
        ${TEST_LOGINS.map(t => `<tr><td>${esc({ teacher: 'Teacher', technician: 'Lab technician', admin: 'Head of department' }[t.role])}</td><td><code>${esc(t.email)}</code></td><td><code>${esc(t.password)}</code></td><td class="right"><button type="button" class="btn small" data-fill="${esc(t.email)}">Use</button></td></tr>`).join('')}</tbody></table>
        <p class="muted xs">Demo mode only. The test teacher is “Teacher C” on the timetable, so they see real lessons and requests.</p></section>
      <p class="muted small">To use your school’s real data, set up the Google Sheet and switch config.js to live mode (see README).</p>` : ''}
  </main>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target); const btn = e.target.querySelector('button'); btn.disabled = true; $('#lerr').textContent = '';
    try { await login(f.get('username'), f.get('password')); saveSession(); await afterSignIn(); }
    catch (err) { $('#lerr').textContent = authMsg(err); btn.disabled = false; }
  };
  document.querySelectorAll('[data-fill]').forEach(b => b.onclick = () => { const t = TEST_LOGINS.find(x => x.email === b.dataset.fill);
    $('#lf [name=username]').value = t.email; $('#lf [name=password]').value = t.password; $('#lf [name=password]').focus(); });
  document.querySelectorAll('[data-email]').forEach(b => b.onclick = async () => {
    const u = demoPick.find(x => x.email === b.dataset.email); session.me = { email: u.email, name: u.name, role: u.role, hasPassword: !!u.hasPassword };
    saveSession(); await boot();
  });
  if (!isDemo() && !CONFIG.API_URL) { $('#lerr').textContent = 'config.js is missing API_URL.'; return; }
  if (google) {
    try { await loadScript('https://accounts.google.com/gsi/client'); } catch (e) { return; }
    window.google.accounts.id.initialize({ client_id: CONFIG.GOOGLE_CLIENT_ID, hd: CONFIG.SCHOOL_DOMAIN || undefined, callback: async r => {
      Object.assign(session, { idToken: r.credential, token: null });
      try { await refresh(); saveSession(); await boot(true); }
      catch (e) { session.idToken = null; $('#lerr').textContent = authMsg(e); }
    } });
    window.google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', text: 'signin_with' });
  }
}

async function afterSignIn() { if (session.me.mustChange) return firstPasswordView(); await boot(); }

/** Shown after signing in with a temporary password. Nothing else works until a new password is set. */
function firstPasswordView() {
  document.documentElement.dataset.theme = 'teal';
  $('#app').innerHTML = `<main class="login">
    <span class="brand">Practicals</span>
    <form id="nf" class="card stack" style="width:min(420px,100%);text-align:left">
      <h1 class="h2" style="font-family:var(--display);font-size:24px">Choose your password</h1>
      <p class="muted small">Hello ${esc(session.me.name)}. You signed in with a temporary password. Choose your own now — at least 8 characters. Only you will know it.</p>
      <label class="fld">New password<input name="p1" type="password" autocomplete="new-password" minlength="8" required></label>
      <label class="fld">Type it again<input name="p2" type="password" autocomplete="new-password" minlength="8" required></label>
      <p id="nerr" class="err small" role="alert"></p>
      <button class="btn pri big block">Save and continue</button>
      <button type="button" class="linkbtn small" id="cancelNew">Sign out</button>
    </form></main>`;
  $('#nf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    if (f.get('p1') !== f.get('p2')) { $('#nerr').textContent = 'The two passwords don’t match.'; return; }
    try { await changePassword('', f.get('p1')); saveSession(); toast('Password saved'); await boot(); } catch (err) { $('#nerr').textContent = authMsg(err); }
  };
  $('#cancelNew').onclick = async () => { await logout(); saveSession(); render(); };
}

/** Change password from the sidebar. */
function passwordDialog() {
  const d = modal(`<div class="row between"><h2 class="h2">Change password</h2><button class="icon-btn" data-close aria-label="Close">×</button></div>
    <form id="cpf" class="stack">
      <label class="fld">Current password<input name="cur" type="password" autocomplete="current-password" required></label>
      <label class="fld">New password (at least 8 characters)<input name="p1" type="password" autocomplete="new-password" minlength="8" required></label>
      <label class="fld">Type it again<input name="p2" type="password" autocomplete="new-password" minlength="8" required></label>
      <p id="cperr" class="err small" role="alert"></p>
      <div class="row end gap"><button type="button" class="btn" data-close>Cancel</button><button class="btn pri">Save password</button></div></form>`);
  d.querySelector('#cpf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    if (f.get('p1') !== f.get('p2')) { d.querySelector('#cperr').textContent = 'The two new passwords don’t match.'; return; }
    try { await changePassword(f.get('cur'), f.get('p1')); saveSession(); closeModal(); toast('Password changed'); } catch (err) { d.querySelector('#cperr').textContent = authMsg(err); }
  };
}
const loadScript = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });

async function boot(loaded) {
  try { if (!loaded) await refresh(); }
  catch (e) {
    if (/must_change_password/.test(e.message)) return firstPasswordView();
    if (/token|not_signed|session_expired|not_registered/.test(e.message)) { Object.assign(session, { me: null, token: null, idToken: null }); saveSession(); go('#/login'); return render(); }
    toast('Could not load data: ' + e.message, 'bad'); }
  applyTheme();
  if (!location.hash || location.hash === '#/login') go('#/' + home_()); else render();
}

export async function render() {
  if (!session.me) return loginView();
  if (session.me.mustChange) return firstPasswordView();
  const [name, ...rest] = location.hash.replace(/^#\//, '').split('?')[0].split('/');
  const view = ROUTES[name] ? name : home_();
  shell(ROUTES[name] ? [name, ...rest].join('/') : view);
  const el = $('#view');
  try { await ROUTES[view].render(el, rest, new URLSearchParams(location.hash.split('?')[1] || '')); }
  catch (e) { console.error(e); el.innerHTML = `<div class="empty">Something went wrong: ${esc(e.message)}</div>`; }
}
export async function reload() { await refresh(); await render(); }

window.addEventListener('hashchange', () => render());
(async () => {
  try { const s = JSON.parse(sessionStorage.getItem('sp_session') || 'null'); if (s && s.me) Object.assign(session, s); } catch (e) {}
  if (session.me) await boot(); else render();
})();
