// Pure helpers: dates, deadlines, lab availability, equipment clashes.
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const ACTIVE = ['submitted', 'accepted', 'in_progress', 'ready', 'done'];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const min = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
export const fmtMin = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
export const overlap = (a1, a2, b1, b2) => min(a1) < min(b2) && min(b1) < min(a2);

export const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const dayCode = s => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parse(s).getDay()];
export const monday = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const k = (x.getDay() + 6) % 7; return addDays(x, -k); };
export const nice = s => parse(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const niceLong = s => parse(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

export function isSchoolDay(d, holidays = []) { const k = d.getDay(); return k !== 0 && k !== 6 && !holidays.includes(iso(d)); }

/** Last day a practical can be booked: end of the working day `leadDays` working days before the lesson. */
export function deadline(dateStr, leadDays = 3, holidays = []) {
  let d = parse(dateStr), n = 0;
  while (n < leadDays) { d = addDays(d, -1); if (isSchoolDay(d, holidays)) n++; }
  return iso(d);
}
export function isLate(dateStr, settings, now = new Date()) {
  const dl = deadline(dateStr, Number(settings.leadDays) || 3, settings.holidays || []);
  return iso(now) > dl;
}

/** The teacher's lessons over the next `weeks` weeks, from the weekly timetable. */
export function upcomingLessons(db, teacher, weeks = 4, from = new Date()) {
  const out = []; const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i); if (!isSchoolDay(d, db.settings.holidays || [])) continue;
    const code = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    db.timetable.filter(t => t.teacher === teacher && t.day === code).sort((a, b) => min(a.start) - min(b.start))
      .forEach(t => out.push({ ...t, date: iso(d) }));
  }
  return out;
}

export const labRooms = db => db.labs.filter(l => l.type === 'lab');
export const isLabRoom = (db, room) => labRooms(db).some(l => l.room === room);
export const roomName = (db, room) => (db.labs.find(l => l.room === room) || {}).name || room;

/** Status of every lab at a date and time: free / lesson (no practical) / practical booked. */
export function labStatus(db, date, start, end, excludeId) {
  const code = dayCode(date);
  return labRooms(db).map(l => {
    const req = db.requests.find(r => r.id !== excludeId && r.room === l.room && r.date === date && ACTIVE.includes(r.status) && overlap(r.start, r.end, start, end));
    if (req) return { room: l.room, name: l.name, state: 'practical', who: req.teacher, cls: req.class, title: req.title };
    const les = db.timetable.find(t => t.room === l.room && t.day === code && overlap(t.start, t.end, start, end));
    if (les) return { room: l.room, name: l.name, state: 'lesson', who: les.teacher, cls: les.class };
    return { room: l.room, name: l.name, state: 'free' };
  }).sort((a, b) => ({ free: 0, lesson: 1, practical: 2 }[a.state] - { free: 0, lesson: 1, practical: 2 }[b.state]) || a.room.localeCompare(b.room));
}

export const totalStock = item => Object.values(item.rooms || {}).reduce((s, v) => s + (Number(v) || 0), 0);

/** Equipment needed by `req` that other bookings at the same time already use up. */
export function clashes(db, req) {
  const out = [];
  for (const k of req.kit || []) {
    const item = db.inventory.find(i => i.id === k.itemId);
    if (!item || item.list !== 'Equipment') continue;
    const others = db.requests.filter(r => r.id !== req.id && r.date === req.date && ACTIVE.includes(r.status) && r.status !== 'done' && overlap(r.start, r.end, req.start, req.end))
      .map(r => ({ r, q: (r.kit || []).filter(x => x.itemId === k.itemId).reduce((s, x) => s + (Number(x.qty) || 0), 0) })).filter(x => x.q > 0);
    const used = others.reduce((s, x) => s + x.q, 0), have = totalStock(item);
    if (used + (Number(k.qty) || 0) > have) out.push({ item, need: Number(k.qty) || 0, have, used, others });
  }
  return out;
}

/** Items on a request that we can't supply at all: not in the inventory, or none in stock. (Not enough of = clashes().) */
export function unavailable(db, req) {
  return (req.kit || []).map(k => ({ k, item: k.itemId ? db.inventory.find(i => i.id === k.itemId) : null }))
    .filter(x => !x.item || totalStock(x.item) <= 0)
    .map(x => ({ name: String(x.k.name || '').replace(/ — not in our inventory$/, ''), qty: x.k.qty, reason: x.item ? 'none in stock' : 'not in our inventory' }));
}

export function hazcardsFor(db, kit) {
  const codes = new Set();
  (kit || []).forEach(k => { const it = db.inventory.find(i => i.id === k.itemId); (it?.hazcards || []).forEach(c => codes.add(c)); });
  return [...codes].map(c => db.hazcards.find(h => h.code === c) || { code: c, title: '', url: '' });
}

/** Where a request is on the 7-step path Draft › Submitted › Accepted › In prep › Ready › In use › Closed. */
export const STAGES = ['Draft', 'Submitted', 'Accepted', 'In prep', 'Ready', 'In use', 'Closed'];
export function stageOf(r, today = iso(new Date())) {
  if (r.status === 'done') return 7;
  if (r.status === 'ready') return r.date === today ? 6 : r.date < today ? 7 : 5;
  return { draft: 1, submitted: 2, accepted: 3, in_progress: 4 }[r.status] || 1;
}
/** 0 not started, 1 in progress, 2 prepared — the technicians' traffic light. */
export const prepOf = r => r.status === 'done' || r.status === 'ready' ? 2 : r.status === 'in_progress' ? 1 : Number(r.prep) || 0;

export function gradeOf(cls) { const m = String(cls || '').match(/(\d+)/); return m ? Number(m[1]) : ''; }

/** Simple CSV (RFC 4180-ish) both ways. */
export function toCSV(rows) {
  if (!rows.length) return '';
  const head = [...rows.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set())];
  const cell = v => { v = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [head.join(','), ...rows.map(r => head.map(h => cell(r[h])).join(','))].join('\n');
}
export function fromCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter(r => r.join('') !== '').map(r => Object.fromEntries(head.map((h, i) => {
    let v = r[i] ?? ''; if (/^[\[{]/.test(v)) { try { v = JSON.parse(v); } catch (e) {} }
    return [h.trim(), v];
  })));
}
