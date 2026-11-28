// Data layer. The same actions run against the browser (demo) or the Google Sheet (live).
import { CONFIG } from './config.js';
import { iso, addDays, monday, DAYS, isLabRoom, min, ruleSave, ruleUpdate, rulePostpone } from './logic.js';
import { busy, labelFor } from './loader.js';

export const db = { settings: {}, users: [], labs: [], timetable: [], inventory: [], hazcards: [], library: [], requests: [], log: [] };
export const session = { me: null, idToken: null, token: null };
const KEY = 'sp_demo_db_v5'; // v5: other names of chemicals; v4: recipes and risk cards; v3: SDS links; v2: on-time requests booked straight away
const TABLE_KEY = { Settings: 'settings', Users: 'users', Labs: 'labs', Timetable: 'timetable', Inventory: 'inventory', Hazcards: 'hazcards', Library: 'library', Requests: 'requests', InventoryLog: 'log', Recipes: 'recipes', RiskCards: 'riskcards' };
export const TABLES = Object.keys(TABLE_KEY);
const KEYCOL = { Users: 'email', Labs: 'room', Timetable: 'id', Inventory: 'id', Hazcards: 'code', Library: 'id', Requests: 'id', Recipes: 'number', RiskCards: 'code' };
const uid = p => p + Math.random().toString(36).slice(2, 10);

/* ---------------- live (Google Apps Script) ---------------- */
async function live(action, data) {
  const res = await fetch(CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, data, idToken: session.idToken, token: session.token }) });
  const out = await res.json();
  if (!out.ok) throw new Error(out.error || 'server_error');
  if (out.me) session.me = out.me;
  return out.data;
}

/* ---------------- demo (localStorage) ---------------- */
let demo = null;
function saveDemo() { try { localStorage.setItem(KEY, JSON.stringify(demo)); } catch (e) {} }
/** Test sign-ins while the app is not connected to the Google Sheet (data never leaves the browser). Passwords are in the README. */
export const TEST_LOGINS = [
  { email: 'test.teacher', name: 'Teacher C', role: 'teacher', salt: 'demo-test.teacher', passwordHash: 'pCiPAfIotU1+tH1c2YKOKCHr8VIv3KbwP+UWvUH2kvI=' },
  { email: 'test.labtech', name: 'Test Lab Technician', role: 'technician', salt: 'demo-test.labtech', passwordHash: 'aaPjF/4VXQAjRNJQCv7HxrKA/P7Iw5vg41tkpHyiHm0=' },
  { email: 'test.hod', name: 'Test Head of Department', role: 'admin', salt: 'demo-test.hod', passwordHash: 'ac7AHROm08tbqKBmx4EXzNM1G9N/Qiorzgo1Rm1ERRs=' }
];
function ensureTestUsers() {
  let added = false;
  TEST_LOGINS.forEach(u => { if (!demo.users.some(x => String(x.email).toLowerCase() === u.email)) { demo.users.push({ ...u, active: true, mustChange: false }); added = true; } });
  if (added) saveDemo();
}
async function loadDemo() {
  try { const s = localStorage.getItem(KEY); if (s) { demo = JSON.parse(s); ensureTestUsers(); return; } } catch (e) {}
  const names = ['settings', 'users', 'labs', 'timetable', 'inventory', 'hazcards', 'library', 'recipes', 'riskcards'];
  const parts = await Promise.all(names.map(n => fetch(`data/demo/${n}.json`).then(r => r.json())));
  demo = Object.fromEntries(names.map((n, i) => [n, parts[i]]));
  demo.requests = sampleRequests(demo); demo.log = [];
  saveDemo(); ensureTestUsers();
}
export function resetDemo() { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); }

/** Sample bookings this week and next so the demo isn't empty. */
function sampleRequests(d) {
  const out = []; const mon = monday(new Date());
  const pickLib = s => d.library.find(p => p.subject === s.subject) || d.library.find(p => p.course === s.course) || null;
  const lessons = d.timetable.filter(t => isLabRoom(d, t.room));
  let n = 0;
  for (let w = 0; w < 2; w++) DAYS.forEach((day, di) => {
    lessons.filter(t => t.day === day).forEach((t, k) => {
      if ((k + di + w) % 3) return;
      const p = pickLib(t); if (!p) return;
      const date = iso(addDays(mon, w * 7 + di)); const sets = 6 + (n % 3) * 2;
      const past = date < iso(new Date());
      out.push({ id: 'r' + (++n), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), teacherEmail: '', teacher: t.teacher, class: t.class, grade: t.grade, subject: t.subject,
        date, start: t.start, end: t.end, room: t.room, timetabledRoom: t.room, practicalId: p.id, title: p.title, sets,
        kit: p.kit.map(k => ({ itemId: k.itemId, name: k.name, qty: k.perGroup * sets, ...(k.conc ? { conc: k.conc, vol: k.vol } : {}) })), notes: '', method: p.method || '',
        status: past ? 'done' : (n % 6 === 0 ? 'submitted' : 'accepted'), prep: past ? 2 : n % 6 === 0 ? 0 : n % 3, late: n % 6 === 0, lateChoice: n % 6 === 0 ? 'draft' : '', history: [] });
    });
  });
  // make the demo teacher's emails line up
  const me = d.users.find(u => u.role === 'teacher'); out.forEach(r => { if (r.teacher === me.name) r.teacherEmail = me.email; });
  return out;
}

/* ---------- passwords (demo mode mirrors what Code.gs does on the server) ---------- */
const AUTH_COLS = ['passwordHash', 'salt', 'mustChange'];
const te = new TextEncoder();
async function pbkdf2(pw, salt) {
  const k = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(salt), iterations: 100000 }, k, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
function tempPassword() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789'; const b = crypto.getRandomValues(new Uint8Array(10));
  const s = [...b].map(x => A[x % A.length]).join(''); return s.slice(0, 5) + '-' + s.slice(5);
}
async function setPassword(u, pw, mustChange) { u.salt = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2); u.passwordHash = await pbkdf2(pw, u.salt); u.mustChange = !!mustChange; }
const publicUser = u => { const o = { ...u }; AUTH_COLS.forEach(c => delete o[c]); o.hasPassword = !!u.passwordHash; o.mustChange = !!u.mustChange; return o; };
const findUser = id => demo.users.find(u => String(u.email).toLowerCase() === String(id || '').trim().toLowerCase());
const meOf = u => ({ email: String(u.email).toLowerCase(), name: u.name, role: u.role, hasPassword: !!u.passwordHash, mustChange: !!u.mustChange });
const isActive = u => !(u.active === false || String(u.active).toUpperCase() === 'FALSE');
const fails = {};

async function demoAuth(action, data) {
  const me = session.me;
  switch (action) {
    case 'login': {
      const id = String(data.username || '').trim().toLowerCase();
      if ((fails[id] || 0) >= 5) throw new Error('too_many_attempts');
      const u = findUser(id);
      if (!u || !u.passwordHash || !isActive(u) || (await pbkdf2(data.password || '', u.salt)) !== u.passwordHash) { fails[id] = (fails[id] || 0) + 1; throw new Error('bad_login'); }
      fails[id] = 0; return { token: 'demo', me: meOf(u) };
    }
    case 'changePassword': {
      if (String(data.password || '').length < 8) throw new Error('password_too_short');
      const u = findUser(me.email); if (!u) throw new Error('not_registered');
      if (!u.mustChange && (!u.passwordHash || (await pbkdf2(data.current || '', u.salt)) !== u.passwordHash)) throw new Error('wrong_current_password');
      if (u.passwordHash && (await pbkdf2(data.password, u.salt)) === u.passwordHash) throw new Error('same_password');
      await setPassword(u, data.password, false); saveDemo(); return meOf(u);
    }
    case 'saveUser': case 'resetPassword': {
      if (me.role !== 'admin') throw new Error('forbidden');
      const row = action === 'resetPassword' ? publicUser(findUser(data.email) || {}) : (data.user || {});
      const isNew = action === 'saveUser' && data.isNew; const makePassword = action === 'resetPassword' || data.makePassword;
      const id = String(row.email || '').trim().toLowerCase();
      if (!id || /\s/.test(id)) throw new Error('bad_username');
      const ex = findUser(id);
      if (isNew && ex) throw new Error('username_taken');
      if (!isNew && !ex) throw new Error('not_found');
      const u = { email: ex ? ex.email : id, name: String(row.name || '').trim(), role: ['teacher', 'technician', 'admin'].includes(row.role) ? row.role : 'teacher', active: isActive(row) };
      AUTH_COLS.forEach(c => { if (ex && ex[c] !== undefined) u[c] = ex[c]; });
      let temp = ''; if (makePassword) { temp = tempPassword(); await setPassword(u, temp, true); }
      if (ex) Object.keys(ex).forEach(k => delete ex[k]);
      if (ex) Object.assign(ex, u); else demo.users.push(u);
      saveDemo(); return { user: publicUser(u), tempPassword: temp };
    }
    case 'removeUser': {
      if (me.role !== 'admin') throw new Error('forbidden');
      if (String(data.email).toLowerCase() === me.email.toLowerCase()) throw new Error('cannot_remove_yourself');
      demo.users = demo.users.filter(u => String(u.email).toLowerCase() !== String(data.email).toLowerCase()); saveDemo(); return true;
    }
  }
  return undefined;
}

function demoAction(action, data) {
  const me = session.me; const now = new Date().toISOString();
  const can = roles => { if (!roles.includes(me.role)) throw new Error('forbidden'); };
  switch (action) {
    case 'bootstrap': { const d = JSON.parse(JSON.stringify(demo)); d.users = d.users.map(publicUser); return d; }
    case 'saveRequest': {
      const ex = data.request.id && demo.requests.find(x => x.id === data.request.id);
      if (ex && me.role === 'teacher' && ex.teacherEmail !== me.email && ex.teacher !== me.name) throw new Error('forbidden');
      const r = ruleSave(ex, data.request, me, demo.settings);
      if (!ex) Object.assign(r, { id: uid('r'), createdAt: now, teacherEmail: me.email, teacher: r.teacher || me.name });
      r.updatedAt = now; r.history = (ex?.history || []).concat([{ at: now, by: me.name, what: ex ? 'edited' : (r.status === 'draft' ? 'draft saved' : r.status === 'submitted' ? 'sent late — waiting for approval' : 'booked') }]);
      if (ex) Object.assign(ex, r); else demo.requests.push(r); saveDemo(); return r;
    }
    case 'updateRequest': {
      const r = demo.requests.find(x => x.id === data.id); if (!r) throw new Error('not_found');
      if (me.role === 'teacher' && r.teacherEmail !== me.email && r.teacher !== me.name) throw new Error('forbidden');
      const patch = ruleUpdate(r, data.patch, me);
      Object.assign(r, patch, { updatedAt: now });
      r.history = (r.history || []).concat([{ at: now, by: me.name, what: Object.keys(patch).map(k => k + ' → ' + (typeof patch[k] === 'object' ? JSON.stringify(patch[k]) : patch[k])).join(', ') }]);
      saveDemo(); return r;
    }
    case 'postponeRequest': {
      const r = demo.requests.find(x => x.id === data.id); if (!r) throw new Error('not_found');
      if (me.role === 'teacher' && r.teacherEmail !== me.email && r.teacher !== me.name) throw new Error('forbidden');
      const patch = rulePostpone(r, data.slot, me);
      Object.assign(r, patch, { updatedAt: now });
      r.history = (r.history || []).concat([{ at: now, by: me.name, what: 'postponed to ' + patch.date + ' ' + patch.start }]);
      saveDemo(); return r;
    }
    case 'adjustStock': {
      can(['admin', 'technician']);
      const it = demo.inventory.find(i => i.id === data.itemId); it.rooms[data.room] = Math.max(0, (Number(it.rooms[data.room]) || 0) + Number(data.change));
      demo.log.push({ at: now, by: me.name, itemId: it.id, item: it.name + (it.size ? ' ' + it.size : ''), room: data.room, change: data.change, reason: data.reason || '' });
      saveDemo(); return it;
    }
    case 'upsert': {
      const k = TABLE_KEY[data.table], col = KEYCOL[data.table];
      if (data.table === 'Users') throw new Error('use_saveUser');
      if (data.table === 'Settings') { Object.assign(demo.settings, data.row); saveDemo(); return data.row; }
      if (!data.row[col]) data.row[col] = uid(data.table[0].toLowerCase());
      const list = demo[k]; const i = list.findIndex(x => x[col] === data.row[col]);
      if (i >= 0) list[i] = data.row; else list.push(data.row); saveDemo(); return data.row;
    }
    case 'remove': { const k = TABLE_KEY[data.table], col = KEYCOL[data.table]; demo[k] = demo[k].filter(x => String(x[col]) !== String(data.key)); saveDemo(); return true; }
    case 'importTable': {
      can(['admin']); const k = TABLE_KEY[data.table];
      if (data.table === 'Settings') { demo.settings = data.mode === 'append' ? { ...demo.settings, ...data.rows } : data.rows; }
      else if (data.table === 'Users') { // never take passwords from a file; keep the ones people already have
        const rows = data.rows.map(r => { const o = findUser(r.email) || {}; const n = { ...r, email: String(r.email || '').trim().toLowerCase() }; AUTH_COLS.forEach(c => { if (o[c] !== undefined) n[c] = o[c]; else delete n[c]; }); delete n.hasPassword; return n; });
        demo.users = data.mode === 'append' ? demo.users.concat(rows) : rows; }
      else demo[k] = data.mode === 'append' ? demo[k].concat(data.rows) : data.rows;
      saveDemo(); return Array.isArray(data.rows) ? data.rows.length : 1;
    }
    case 'exportTable': { const rows = JSON.parse(JSON.stringify(demo[TABLE_KEY[data.table]])); return data.table === 'Users' ? rows.map(publicUser) : rows; }
  }
  throw new Error('unknown_action');
}

/* ---------------- public API ---------------- */
/** True until config.js has the Apps Script URL: data is then kept in this browser only. */
export const isDemo = () => !CONFIG.API_URL;
/** Run an action on the server. After a save, the change is also made to the data already in this tab, so the page
 *  can show it at once instead of loading every table again (see reload() in app.js). */
export async function call(action, data = {}) {
  const out = await busy(callRaw(action, data), labelFor(action));
  if (!isDemo() && !READS.includes(action)) { gen++; if (!patchLocal(action, data, out)) unpatched = true; saveCacheFromDb(); }
  return out;
}
async function callRaw(action, data = {}) {
  if (isDemo()) {
    if (!demo) await loadDemo();
    if (session.me?.mustChange && !['changePassword', 'login'].includes(action)) throw new Error('must_change_password');
    const a = await demoAuth(action, data); if (a !== undefined) return a;
    return demoAction(action, data);
  }
  return live(action, data);
}

/** Username + password sign-in. Sets the session; returns the signed-in person. */
export async function login(username, password) {
  let out;
  if (isDemo()) out = await call('login', { username, password });
  else {
    const res = await busy(fetch(CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'login', data: { username, password } }) }).then(r => r.json()), labelFor('login'));
    const j = res; if (!j.ok) throw new Error(j.error || 'server_error'); out = j.data;
  }
  Object.assign(session, { me: out.me, token: out.token, idToken: null });
  return out.me;
}
export async function changePassword(current, password) { const me = await call('changePassword', { current, password }); session.me = { ...session.me, ...me, mustChange: false }; return session.me; }
export async function logout() { try { if (!isDemo() && session.token) await live('logout'); } catch (e) {} Object.assign(session, { me: null, token: null, idToken: null }); clearCache(); }
export async function demoUsers() { if (!demo) await loadDemo(); return demo.users; }

/* A Google Sheet turns "08:30" into a date (30 Dec 1899) and "2026-11-30" into a timestamp.
   Older copies of the Apps Script sent those back as ISO strings: turn them back into what was typed. */
const pad = n => String(n).padStart(2, '0');
function asTime(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return v;
  const d = new Date(v); return isNaN(d) ? v : pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function asDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v)) return v;
  const d = new Date(v); return isNaN(d) ? v : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* ---------------- quick loading ----------------
   Loading every table from the Google Sheet takes a few seconds. So:
   - the last data loaded is kept in this browser (one copy, for the person signed in) and shown straight away on the
     next visit, while fresh data loads quietly behind it. It is wiped on sign-out and is never shown to anyone else;
   - after a save, the change is made to the data in the tab (patchLocal), so the page updates at once. */
const CACHE = 'sp_cache_v1', CACHE_HOURS = 12;
const READS = ['bootstrap', 'exportTable', 'login', 'logout', 'changePassword'];
let gen = 0;            // goes up with every save, so a load that started before a save is not allowed to undo it
let unpatched = false;  // a save that could not be made locally: the next reload must load everything
const who = () => session.me ? String(session.me.email || '').toLowerCase() + '|' + session.me.role : '';

function saveCache(raw) {
  if (isDemo() || !session.me) return;
  try { localStorage.setItem(CACHE, JSON.stringify({ who: who(), at: Date.now(), data: raw })); }
  catch (e) { clearCache(); } // full or blocked: just go without
}
function saveCacheFromDb() { saveCache(db); }
export function clearCache() { try { localStorage.removeItem(CACHE); } catch (e) {} }
/** Put the last data this person loaded into the tab. True if there was any. */
export function loadCached() {
  if (isDemo() || !session.me) return false;
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null');
    if (!c || c.who !== who() || !c.data || Date.now() - c.at > CACHE_HOURS * 3600e3) return false;
    apply(c.data); return true;
  } catch (e) { return false; }
}
/** True when every save since the last load was also made in the tab, so nothing needs loading before showing it. */
export const savedLocally = () => !isDemo() && !unpatched;

const normRequest = r => {
  r.start = asTime(r.start); r.end = asTime(r.end); r.date = asDay(r.date);
  r.kit = Array.isArray(r.kit) ? r.kit : []; r.prep = Number(r.prep) || 0; r.late = r.late === true || r.late === 'TRUE' || r.late === 'true';
  return r;
};
const normItem = i => { i.rooms = i.rooms || {}; i.storage = i.storage || {}; i.hazcards = Array.isArray(i.hazcards) ? i.hazcards : []; return i; };
const normPractical = p => { p.kit = Array.isArray(p.kit) ? p.kit : []; p.grade = Number(p.grade) || (p.grade == null ? '' : String(p.grade)); return p; };
const sortRequests = () => db.requests.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start) || min(a.start) - min(b.start));
function putRow(list, key, row) {
  const i = list.findIndex(x => String(x[key]) === String(row[key]));
  if (i >= 0) list[i] = { ...list[i], ...row }; else list.push(row);
  return i >= 0 ? list[i] : row;
}

/** Make a save that the server has accepted in the data already in the tab. False if it can't be done here. */
function patchLocal(action, data, out) {
  try {
    switch (action) {
      case 'saveRequest': case 'updateRequest': case 'postponeRequest':
        if (!out || !out.id) return false;
        normRequest(putRow(db.requests, 'id', JSON.parse(JSON.stringify(out)))); sortRequests(); return true;
      case 'adjustStock':
        if (!out || !out.id) return false;
        normItem(putRow(db.inventory, 'id', JSON.parse(JSON.stringify(out))));
        if (Array.isArray(db.log) && session.me.role !== 'teacher')
          db.log.push({ at: new Date().toISOString(), by: session.me.name, itemId: out.id, item: out.name + (out.size ? ' ' + out.size : ''), room: data.room, change: data.change, reason: data.reason || '' });
        return true;
      case 'upsert': {
        if (data.table === 'Settings') return false;
        const list = db[TABLE_KEY[data.table]], key = KEYCOL[data.table];
        if (!Array.isArray(list) || !key || !out || !out[key]) return false;
        const row = putRow(list, key, JSON.parse(JSON.stringify(out)));
        if (data.table === 'Inventory') normItem(row);
        if (data.table === 'Library') normPractical(row);
        if (data.table === 'Requests') { normRequest(row); sortRequests(); }
        return true;
      }
      case 'remove': {
        const list = db[TABLE_KEY[data.table]], key = KEYCOL[data.table];
        if (!Array.isArray(list) || !key) return false;
        db[TABLE_KEY[data.table]] = list.filter(x => String(x[key]) !== String(data.key)); return true;
      }
      case 'saveUser': case 'resetPassword':
        if (!out || !out.user || !out.user.email) return false;
        putRow(db.users, 'email', { ...out.user }); return true;
      case 'removeUser':
        db.users = db.users.filter(u => String(u.email).toLowerCase() !== String(data.email).toLowerCase()); return true;
      default: return false; // imports and anything new: load everything again
    }
  } catch (e) { return false; }
}

/** Load every table from the server. With quiet, no loading screen is shown (the page is already on screen).
 *  Returns true if the data changed. */
export async function refresh({ quiet = false } = {}) {
  for (let tries = 0; ; tries++) {
    const startGen = gen;
    const d = quiet ? await callRaw('bootstrap') : await busy(callRaw('bootstrap'), labelFor('bootstrap'));
    if (gen !== startGen && tries < 2) continue; // a save happened while loading: load again so it isn't undone
    const before = JSON.stringify(db);
    apply(d); unpatched = false; saveCache(db);
    return JSON.stringify(db) !== before;
  }
}

function apply(d) {
  const s = d.settings || {}; const norm = {};
  Object.keys(s).forEach(k => { let v = s[k]; if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) {} } norm[k] = v; });
  ['dayStart', 'dayEnd'].forEach(k => { if (norm[k]) norm[k] = asTime(norm[k]); });
  norm.leadDays = Number(norm.leadDays) || 3; norm.holidays = Array.isArray(norm.holidays) ? norm.holidays : [];
  Object.assign(db, d, { settings: norm });
  db.inventory.forEach(normItem);
  db.requests.forEach(normRequest);
  db.library.forEach(normPractical);
  db.timetable.forEach(t => { t.grade = Number(t.grade) || t.grade; t.start = asTime(t.start); t.end = asTime(t.end); });
  sortRequests();
  return db;
}
