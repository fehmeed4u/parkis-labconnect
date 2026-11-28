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

/** Where a request is on the 7-step path Draft › Sent › Booked › In prep › Ready › In use › Closed. (On time: Sent and Booked at once.) */
export const STAGES = ['Draft', 'Sent', 'Booked', 'In prep', 'Ready', 'In use', 'Closed'];
export function stageOf(r, today = iso(new Date())) {
  if (r.status === 'done') return 7;
  if (r.status === 'ready') return r.date === today ? 6 : r.date < today ? 7 : 5;
  return { draft: 1, submitted: 2, accepted: 3, in_progress: 4 }[r.status] || 1;
}
/** 0 not started, 1 in progress, 2 prepared — the technicians' traffic light. */
export const prepOf = r => r.status === 'done' || r.status === 'ready' ? 2 : r.status === 'in_progress' ? 1 : Number(r.prep) || 0;

/** Grades a library practical is for: 11 → [11], "11-12" → [11, 12], "9, 10" → [9, 10]. */
export function gradesOf(p) {
  const v = String(p?.grade ?? '').trim();
  const r = v.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
  if (r) { const out = []; for (let n = Number(r[1]); n <= Number(r[2]) && out.length < 8; n++) out.push(n); return out; }
  return v.split(/[\s,/&]+/).map(Number).filter(Boolean);
}
/** "G11", "G11–12", or "" when no grade is set. */
export const gradeLabel = p => { const g = gradesOf(p); return !g.length ? '' : g.length === 1 ? 'G' + g[0] : 'G' + g[0] + '–' + g[g.length - 1]; };
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

/* ---------- request rules ----------
   One request goes:  draft → accepted (sent on time: booked straight away, no approval step)
                            → submitted (sent late: "waiting for approval" until a technician accepts it)
                      accepted → in_progress → ready → done,  or rejected / cancelled.
   The colour on both calendars: blue = waiting for approval, red = not started, amber = in prep, green = ready.
   apps-script/Code.gs repeats ruleSave / ruleUpdate / rulePostpone on the server — keep the two in step. */
export const lightOf = r => r.status === 'submitted' ? 'w' : prepOf(r);
export const LIGHTS = { w: 'Waiting for approval', 0: 'Not started', 1: 'In prep', 2: 'Ready' };
/** Red (or blue): nobody has started preparing it. */
export const notStarted = r => r.status === 'submitted' || (r.status === 'accepted' && !(Number(r.prep) > 0));
/** Teachers can change or cancel their request only until the technicians start preparing it. */
export const teacherCanEdit = r => r.status === 'draft' || notStarted(r);
/** Booked and still to happen: can be moved to a later lesson (no booking deadline — it may already be prepared). */
export const canPostpone = r => ['submitted', 'accepted', 'in_progress', 'ready'].includes(r.status);
const at = (date, start) => date + ' ' + start;
const nowAt = now => iso(now) + ' ' + fmtMin(now.getHours() * 60 + now.getMinutes());

/** The request as it should be stored when `me` saves `r` (a new one, or a change to `ex`). Throws if the rules don't allow it. */
export function ruleSave(ex, r, me, settings, now = new Date()) {
  const staff = me.role !== 'teacher';
  if (ex && !staff && !teacherCanEdit(ex)) throw new Error('locked');
  const out = { ...r };
  if (r.status === 'draft') { if (ex && ex.status !== 'draft') throw new Error('already_sent'); out.prep = 0; return out; }
  const late = isLate(r.date, settings, now);
  if (!ex || ex.status === 'draft') { Object.assign(out, { late, status: staff || !late ? 'accepted' : 'submitted', prep: 0 }); return out; }
  out.prep = ex.prep; out.late = ex.late;
  if (staff) { out.status = ex.status; return out; }
  // a teacher changing a request nobody has started yet
  const moved = at(r.date, r.start) !== at(ex.date, ex.start);
  if (ex.status === 'submitted') Object.assign(out, { status: late ? 'submitted' : 'accepted', late });
  else if (moved && late && at(r.date, r.start) < at(ex.date, ex.start)) Object.assign(out, { status: 'submitted', late: true }); // moved earlier, past the deadline
  else out.status = 'accepted';
  out.flag = 'Changed by the teacher';
  return out;
}

/** The patch to store when `me` updates request `r`. Throws if the rules don't allow it. */
export function ruleUpdate(r, patch, me) {
  const out = { ...patch };
  if (me.role === 'teacher') {
    Object.keys(patch).forEach(k => { if (!['status', 'rating', 'feedback', 'lateChoice', 'reply', 'query'].includes(k)) throw new Error('forbidden_field:' + k); });
    if (patch.status === 'cancelled') { if (!teacherCanEdit(r)) throw new Error('locked'); }
    else if (patch.status && patch.status !== 'done') throw new Error('forbidden_status');
  }
  if (patch.status === 'cancelled' && r.status !== 'draft' && me.role === 'teacher') out.flag = 'Cancelled by the teacher';
  return out;
}

/** The patch that moves request `r` to a later lesson `slot` ({ date, start, end, room, timetabledRoom }). */
export function rulePostpone(r, slot, me, now = new Date()) {
  if (!canPostpone(r)) throw new Error('cannot_postpone');
  if (at(slot.date, slot.start) <= nowAt(now)) throw new Error('lesson_started');
  if (me.role === 'teacher' && at(slot.date, slot.start) <= at(r.date, r.start)) throw new Error('not_later');
  return { date: slot.date, start: slot.start, end: slot.end, room: slot.room, timetabledRoom: slot.timetabledRoom || slot.room,
    postponedFrom: r.postponedFrom || at(r.date, r.start), flag: `Postponed by the ${me.role === 'teacher' ? 'teacher' : 'technicians'} from ${nice(r.date)} ${r.start}` };
}

/* ---------- safety paperwork for chemicals: CLEAPSS hazcard(s) and the supplier's safety data sheet (SDS) ----------
   Every chemical should have at least one; ideally both. linkSds in Code.gs fills `sds` from the SDS folder. */
export const sdsToCheck = i => /^Close match/.test(i.sdsNote || '');
/** '' = has both · 'no-sds' · 'no-hazcard' · 'none' = neither (not for equipment). */
export function safetyGap(i) {
  if (i.list !== 'Chemicals') return '';
  const hz = (i.hazcards || []).length > 0, sds = !!i.sds;
  return hz && sds ? '' : hz ? 'no-sds' : sds ? 'no-hazcard' : 'none';
}
export const SAFETY_GAP = { none: 'No hazcard and no SDS', 'no-sds': 'Hazcard only — no SDS', 'no-hazcard': 'SDS only — no hazcard' };
