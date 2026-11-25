import { CONFIG } from './config.js';
import { db, session, refresh, isDemo, demoUsers, resetDemo } from './store.js';
import { esc } from './logic.js';
import { $, toast } from './ui.js';
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
  teacher: [['home', 'Home'], ['library', 'Practical library'], ['order', 'Order a practical'], ['inventory', 'Inventory']],
  technician: [['week', 'Week'], ['requests', 'Requests'], ['inventory', 'Inventory'], ['library', 'Practical library']],
  admin: [['admin', 'Overview'], ['week', 'Week'], ['requests', 'Requests'], ['inventory', 'Inventory'], ['library', 'Library'], ['order', 'Order']]
};
const THEMES = [['teal', 'Clean teal'], ['cobalt', 'Ink and cobalt'], ['dark', 'Dark prep room']];

export function go(hash) { location.hash = hash; }
const home_ = () => ({ teacher: 'home', technician: 'week', admin: 'admin' }[session.me.role] || 'home');

function applyTheme() {
  let t = 'teal'; try { t = localStorage.getItem('sp_theme_' + (session.me?.email || '')) || 'teal'; } catch (e) {}
  document.documentElement.dataset.theme = t; try { localStorage.setItem('sp_last_theme', t); } catch (e) {}
}

function shell(active) {
  const nav = NAV[session.me.role] || NAV.teacher;
  $('#app').innerHTML = `
  <header class="top">
    <a class="brand" href="#/${home_()}">Practicals</a>
    <nav aria-label="Main">${nav.map(([k, l]) => `<a href="#/${k}"${k === active ? ' aria-current="page"' : ''}>${esc(l)}</a>`).join('')}</nav>
    <div class="who">
      <div class="themes" role="group" aria-label="Colour scheme">${THEMES.map(([k, l]) => `<button class="sw sw-${k}" data-theme-pick="${k}" aria-label="${esc(l)}" title="${esc(l)}"></button>`).join('')}</div>
      <span class="muted small">${esc(session.me.name)} · ${esc(session.me.role)}</span>
      <button class="btn small" id="signout">${isDemo() ? 'Switch user' : 'Sign out'}</button>
    </div>
  </header>
  ${isDemo() ? `<div class="demo-bar">Demo mode — data is kept only in this browser. <button class="linkbtn" id="resetDemo">Reset demo data</button></div>` : ''}
  <main id="view" tabindex="-1"></main>`;
  $('#signout').onclick = () => { session.me = null; session.idToken = null; try { sessionStorage.removeItem('sp_session'); } catch (e) {} go('#/login'); render(); };
  const rd = $('#resetDemo'); if (rd) rd.onclick = resetDemo;
  document.querySelectorAll('[data-theme-pick]').forEach(b => b.onclick = () => { try { localStorage.setItem('sp_theme_' + session.me.email, b.dataset.themePick); } catch (e) {} applyTheme(); });
}

async function loginView() {
  document.documentElement.dataset.theme = 'teal';
  if (isDemo()) {
    const users = (await demoUsers()).filter(u => ['teacher@demo.school', 'tech@demo.school', 'hod@demo.school'].includes(u.email));
    $('#app').innerHTML = `<main class="login"><h1 class="h1">Science Practicals</h1><p class="muted">Demo mode. Choose who to sign in as:</p>
      <div class="login-cards">${users.map(u => `<button class="card login-card" data-email="${esc(u.email)}"><strong>${esc(u.name)}</strong><span class="muted">${esc({ teacher: 'Teacher', technician: 'Lab technician', admin: 'Head of department (admin)' }[u.role])}</span></button>`).join('')}</div>
      <p class="muted small">To use your school’s real data, set up the Google Sheet and switch config.js to live mode (see README).</p></main>`;
    document.querySelectorAll('[data-email]').forEach(b => b.onclick = async () => {
      const u = users.find(x => x.email === b.dataset.email); session.me = { email: u.email, name: u.name, role: u.role };
      try { sessionStorage.setItem('sp_session', JSON.stringify(session)); } catch (e) {}
      await boot();
    });
    return;
  }
  $('#app').innerHTML = `<main class="login"><h1 class="h1">Science Practicals</h1><p class="muted">Sign in with your school Google account.</p><div id="gbtn"></div><p id="lerr" class="err"></p></main>`;
  if (!CONFIG.GOOGLE_CLIENT_ID || !CONFIG.API_URL) { $('#lerr').textContent = 'config.js is missing API_URL or GOOGLE_CLIENT_ID.'; return; }
  await loadScript('https://accounts.google.com/gsi/client');
  google.accounts.id.initialize({ client_id: CONFIG.GOOGLE_CLIENT_ID, hd: CONFIG.SCHOOL_DOMAIN || undefined, callback: async r => {
    session.idToken = r.credential;
    try { await refresh(); try { sessionStorage.setItem('sp_session', JSON.stringify(session)); } catch (e) {} await boot(true); }
    catch (e) { $('#lerr').textContent = /not_registered/.test(e.message) ? 'Your account isn’t on the staff list yet. Ask the HOD to add you in Admin → People.' : 'Sign-in failed: ' + e.message; }
  } });
  google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', text: 'signin_with' });
}
const loadScript = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });

async function boot(loaded) {
  try { if (!loaded) await refresh(); }
  catch (e) { if (/token|not_signed/.test(e.message)) { session.me = null; go('#/login'); return render(); } toast('Could not load data: ' + e.message, 'bad'); }
  applyTheme();
  if (!location.hash || location.hash === '#/login') go('#/' + home_()); else render();
}

export async function render() {
  if (!session.me) return loginView();
  const [name, ...rest] = location.hash.replace(/^#\//, '').split('?')[0].split('/');
  const view = ROUTES[name] ? name : home_();
  shell(view);
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
