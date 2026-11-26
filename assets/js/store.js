// Data layer. The same actions run against the browser (demo) or the Google Sheet (live).
import { CONFIG } from './config.js';
import { iso, addDays, monday, DAYS, isLabRoom, min } from './logic.js';

export const db = { settings: {}, users: [], labs: [], timetable: [], inventory: [], hazcards: [], library: [], requests: [], log: [] };
export const session = { me: null, idToken: null, token: null };
const KEY = 'sp_demo_db_v1';
const TABLE_KEY = { Settings: 'settings', Users: 'users', Labs: 'labs', Timetable: 'timetable', Inventory: 'inventory', Hazcards: 'hazcards', Library: 'library', Requests: 'requests', InventoryLog: 'log' };
export const TABLES = Object.keys(TABLE_KEY);
const KEYCOL = { Users: 'email', Labs: 'room', Timetable: 'id', Inventory: 'id', Hazcards: 'code', Library: 'id', Requests: 'id' };
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
/** Test sign-ins for the demo (passwords are public — demo mode only; data never leaves the browser). */
export const TEST_LOGINS = [
  { email: 'test.teacher', password: 'Teacher-Test-2026', name: 'Teacher C', role: 'teacher', salt: 'demo-test.teacher', passwordHash: 'pCiPAfIotU1+tH1c2YKOKCHr8VIv3KbwP+UWvUH2kvI=' },
  { email: 'test.labtech', password: 'LabTech-Test-2026', name: 'Test Lab Technician', role: 'technician', salt: 'demo-test.labtech', passwordHash: 'aaPjF/4VXQAjRNJQCv7HxrKA/P7Iw5vg41tkpHyiHm0=' },
  { email: 'test.hod', password: 'Hod-Test-2026', name: 'Test Head of Department', role: 'admin', salt: 'demo-test.hod', passwordHash: 'ac7AHROm08tbqKBmx4EXzNM1G9N/Qiorzgo1Rm1ERRs=' }
];
function ensureTestUsers() {
  let added = false;
  TEST_LOGINS.forEach(({ password, ...u }) => { if (!demo.users.some(x => String(x.email).toLowerCase() === u.email)) { demo.users.push({ ...u, active: true, mustChange: false }); added = true; } });
  if (added) saveDemo();
}
async function loadDemo() {
  try { const s = localStorage.getItem(KEY); if (s) { demo = JSON.parse(s); ensureTestUsers(); return; } } catch (e) {}
  const names = ['settings', 'users', 'labs', 'timetable', 'inventory', 'hazcards', 'library'];
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
        kit: p.kit.map(k => ({ itemId: k.itemId, name: k.name, qty: k.perGroup * sets })), notes: '',
        status: past ? 'done' : (n % 4 === 0 ? 'submitted' : 'accepted'), prep: past ? 2 : n % 3, late: n % 9 === 0, lateChoice: n % 9 === 0 ? 'draft' : '', history: [] });
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
      const r = data.request; const ex = r.id && demo.requests.find(x => x.id === r.id);
      if (!ex) Object.assign(r, { id: uid('r'), createdAt: now, teacherEmail: me.email, teacher: r.teacher || me.name });
      r.updatedAt = now; r.history = (ex?.history || []).concat([{ at: now, by: me.name, what: ex ? 'edited' : (r.status === 'draft' ? 'draft saved' : 'submitted') }]);
      if (me.role === 'teacher' && ex && ['accepted', 'in_progress', 'ready'].includes(ex.status)) r.status = 'submitted';
      if (ex) Object.assign(ex, r); else demo.requests.push(r); saveDemo(); return r;
    }
    case 'updateRequest': {
      const r = demo.requests.find(x => x.id === data.id); if (!r) throw new Error('not_found');
      Object.assign(r, data.patch, { updatedAt: now });
      r.history = (r.history || []).concat([{ at: now, by: me.name, what: Object.keys(data.patch).map(k => k + ' → ' + (typeof data.patch[k] === 'object' ? JSON.stringify(data.patch[k]) : data.patch[k])).join(', ') }]);
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
export const isDemo = () => CONFIG.MODE !== 'live';
export async function call(action, data = {}) {
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
    const res = await fetch(CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'login', data: { username, password } }) });
    const j = await res.json(); if (!j.ok) throw new Error(j.error || 'server_error'); out = j.data;
  }
  Object.assign(session, { me: out.me, token: out.token, idToken: null });
  return out.me;
}
export async function changePassword(current, password) { const me = await call('changePassword', { current, password }); session.me = { ...session.me, ...me, mustChange: false }; return session.me; }
export async function logout() { try { if (!isDemo() && session.token) await live('logout'); } catch (e) {} Object.assign(session, { me: null, token: null, idToken: null }); }
export async function demoUsers() { if (!demo) await loadDemo(); return demo.users; }

export async function refresh() {
  const d = await call('bootstrap');
  const s = d.settings || {}; const norm = {};
  Object.keys(s).forEach(k => { let v = s[k]; if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) {} } norm[k] = v; });
  norm.leadDays = Number(norm.leadDays) || 3; norm.holidays = Array.isArray(norm.holidays) ? norm.holidays : [];
  Object.assign(db, d, { settings: norm });
  db.inventory.forEach(i => { i.rooms = i.rooms || {}; i.storage = i.storage || {}; i.hazcards = Array.isArray(i.hazcards) ? i.hazcards : []; });
  db.requests.forEach(r => { r.kit = Array.isArray(r.kit) ? r.kit : []; r.prep = Number(r.prep) || 0; r.late = r.late === true || r.late === 'TRUE' || r.late === 'true'; });
  db.library.forEach(p => { p.kit = Array.isArray(p.kit) ? p.kit : []; p.grade = Number(p.grade) || p.grade; });
  db.timetable.forEach(t => { t.grade = Number(t.grade) || t.grade; });
  db.requests.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start) || min(a.start) - min(b.start));
  return db;
}
