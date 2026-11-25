// Data layer. The same actions run against the browser (demo) or the Google Sheet (live).
import { CONFIG } from './config.js';
import { iso, addDays, monday, DAYS, isLabRoom, min } from './logic.js';

export const db = { settings: {}, users: [], labs: [], timetable: [], inventory: [], hazcards: [], library: [], requests: [], log: [] };
export const session = { me: null, idToken: null };
const KEY = 'sp_demo_db_v1';
const TABLE_KEY = { Settings: 'settings', Users: 'users', Labs: 'labs', Timetable: 'timetable', Inventory: 'inventory', Hazcards: 'hazcards', Library: 'library', Requests: 'requests', InventoryLog: 'log' };
export const TABLES = Object.keys(TABLE_KEY);
const KEYCOL = { Users: 'email', Labs: 'room', Timetable: 'id', Inventory: 'id', Hazcards: 'code', Library: 'id', Requests: 'id' };
const uid = p => p + Math.random().toString(36).slice(2, 10);

/* ---------------- live (Google Apps Script) ---------------- */
async function live(action, data) {
  const res = await fetch(CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, data, idToken: session.idToken }) });
  const out = await res.json();
  if (!out.ok) throw new Error(out.error || 'server_error');
  if (out.me) session.me = out.me;
  return out.data;
}

/* ---------------- demo (localStorage) ---------------- */
let demo = null;
function saveDemo() { try { localStorage.setItem(KEY, JSON.stringify(demo)); } catch (e) {} }
async function loadDemo() {
  try { const s = localStorage.getItem(KEY); if (s) { demo = JSON.parse(s); return; } } catch (e) {}
  const names = ['settings', 'users', 'labs', 'timetable', 'inventory', 'hazcards', 'library'];
  const parts = await Promise.all(names.map(n => fetch(`data/demo/${n}.json`).then(r => r.json())));
  demo = Object.fromEntries(names.map((n, i) => [n, parts[i]]));
  demo.requests = sampleRequests(demo); demo.log = [];
  saveDemo();
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

function demoAction(action, data) {
  const me = session.me; const now = new Date().toISOString();
  const can = roles => { if (!roles.includes(me.role)) throw new Error('forbidden'); };
  switch (action) {
    case 'bootstrap': return JSON.parse(JSON.stringify(demo));
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
      if (data.table === 'Settings') { Object.assign(demo.settings, data.row); saveDemo(); return data.row; }
      if (!data.row[col]) data.row[col] = uid(data.table[0].toLowerCase());
      const list = demo[k]; const i = list.findIndex(x => x[col] === data.row[col]);
      if (i >= 0) list[i] = data.row; else list.push(data.row); saveDemo(); return data.row;
    }
    case 'remove': { const k = TABLE_KEY[data.table], col = KEYCOL[data.table]; demo[k] = demo[k].filter(x => String(x[col]) !== String(data.key)); saveDemo(); return true; }
    case 'importTable': {
      can(['admin']); const k = TABLE_KEY[data.table];
      if (data.table === 'Settings') { demo.settings = data.mode === 'append' ? { ...demo.settings, ...data.rows } : data.rows; }
      else demo[k] = data.mode === 'append' ? demo[k].concat(data.rows) : data.rows;
      saveDemo(); return Array.isArray(data.rows) ? data.rows.length : 1;
    }
    case 'exportTable': return JSON.parse(JSON.stringify(demo[TABLE_KEY[data.table]]));
  }
  throw new Error('unknown_action');
}

/* ---------------- public API ---------------- */
export const isDemo = () => CONFIG.MODE !== 'live';
export async function call(action, data = {}) {
  if (isDemo()) { if (!demo) await loadDemo(); return demoAction(action, data); }
  return live(action, data);
}
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
