import { db, session, call } from '../store.js';
import { esc, nice, niceLong, deadline, isLate, isLabRoom, labStatus, clashes, unavailable, hazcardsFor, roomName, totalStock, iso, addDays, monday, min, fmtMin, dayCode, isSchoolDay, parse, DAYS, gradeOf } from '../logic.js';
import { $, modal, closeModal, toast, hazcardModal, statusChip } from '../ui.js';
import { go, reload } from '../app.js';
import * as aiImport from './aiimport.js';

/*
  Ordering a practical, in three steps (all on #/order, steered by the query string):
    1. #/order                       → the teacher's own timetable for a week; pick a lesson (block)
    2. #/order?date=…&start=…        → choose: new lab request · from the practical library · AI (coming soon)
    3. …&mode=new  or  …&practical=  → the request form, lesson already filled in
  #/order?id=…  opens an existing order straight in the form.  Staff add &teacher=… to order for someone.
*/

let S = null; // form state
const OPEN = r => !['cancelled', 'rejected'].includes(r.status);
const MAX_WEEKS = 8;

/** Build an #/order link from the current params plus changes (null removes a param). */
export function orderLink(q, changes = {}) {
  const p = new URLSearchParams(q ? q.toString() : '');
  Object.entries(changes).forEach(([k, v]) => v === null || v === undefined || v === '' ? p.delete(k) : p.set(k, v));
  const s = p.toString(); return '#/order' + (s ? '?' + s : '');
}
/** The timetable lesson a teacher has at a date and start time. */
export function lessonAt(teacher, date, start) {
  const t = db.timetable.find(x => x.teacher === teacher && x.day === dayCode(date) && x.start === start);
  return t ? { ...t, date } : null;
}
const ordersFor = (teacher, date, start) => db.requests.filter(r => r.teacher === teacher && r.date === date && r.start === start && OPEN(r));
const dl = date => deadline(date, db.settings.leadDays, db.settings.holidays);

export async function render(el, _rest, q) {
  const me = session.me; const isTeacher = me.role === 'teacher';
  const editing = q.get('id') ? db.requests.find(r => r.id === q.get('id')) : null;
  const teacher = editing ? editing.teacher : isTeacher ? me.name : (q.get('teacher') || '');
  if (editing && !q.get('date') && !q.get('pick')) return form(el, q, editing, teacher);
  if (!teacher || !q.get('date')) return pickLesson(el, q, teacher, editing);
  const lesson = lessonAt(teacher, q.get('date'), q.get('start')) || (editing && editing.date === q.get('date') && editing.start === q.get('start') ? editing : null);
  if (!lesson) { go(orderLink(q, { date: null, start: null })); return; }
  if (!editing && !q.get('mode') && !q.get('practical')) return chooseStart(el, q, teacher, lesson);
  if (!editing && q.get('mode') === 'ai') return fromAI(el, q, teacher, lesson);
  if (!editing && q.get('mode') === 'ai-form' && (!S || S._for !== formKey(q, teacher))) { go(orderLink(q, { mode: 'ai' })); return; }
  return form(el, q, editing, teacher, lesson);
}

/* ---------------- step 1: the teacher's timetable ---------------- */
function pickLesson(el, q, teacher, editing) {
  const me = session.me; const isTeacher = me.role === 'teacher';
  const w = Math.max(0, Math.min(MAX_WEEKS, Number(q.get('w')) || 0));
  const mon = addDays(monday(new Date()), w * 7); const today = iso(new Date()); const now = new Date();
  const dates = DAYS.map((_, i) => iso(addDays(mon, i)));
  const teachers = [...new Set(db.timetable.map(t => t.teacher))].sort();
  const mine = db.timetable.filter(t => t.teacher === teacher);
  const dayStart = Math.min(min(db.settings.dayStart || '08:30'), ...mine.map(t => min(t.start)));
  const dayEnd = Math.max(min(db.settings.dayEnd || '16:00'), ...mine.map(t => min(t.end)));
  const slots = []; for (let t = dayStart; t < dayEnd; t += 30) slots.push(t);
  const slotOf = s => Math.max(0, Math.round((min(s) - dayStart) / 30));
  const practical = q.get('practical') ? db.library.find(p => p.id === q.get('practical')) : null;

  let grid = '';
  if (teacher) {
    grid += `<div class="wgrid tt" style="grid-template-columns:60px repeat(5,minmax(150px,1fr));grid-template-rows:40px repeat(${slots.length},44px);min-width:${60 + 5 * 150}px">`;
    grid += `<div class="gh" style="grid-column:1;grid-row:1"></div>`;
    dates.forEach((d, i) => { const hol = !isSchoolDay(parse(d), db.settings.holidays); grid += `<div class="gh${d === today ? ' today' : ''}" style="grid-column:${2 + i};grid-row:1">${DAYS[i]} ${parse(d).getDate()} ${parse(d).toLocaleDateString('en-GB', { month: 'short' })}${hol ? ' · holiday' : ''}</div>`; });
    slots.forEach((t, r) => { grid += `<div class="gt${(t + 30) % 60 ? '' : ' hr'}" style="grid-column:1;grid-row:${2 + r}">${t % 60 && r ? '' : fmtMin(t)}</div>`;
      dates.forEach((d, i) => grid += `<div class="gc${(t + 30) % 60 ? '' : ' hr'}${isSchoolDay(parse(d), db.settings.holidays) ? '' : ' off'}" style="grid-column:${2 + i};grid-row:${2 + r}"></div>`); });
    dates.forEach((d, i) => {
      if (!isSchoolDay(parse(d), db.settings.holidays)) return;
      mine.filter(t => t.day === DAYS[i]).forEach(t => {
        const started = d < today || (d === today && min(t.start) <= now.getHours() * 60 + now.getMinutes());
        const late = isLate(d, db.settings); const orders = ordersFor(teacher, d, t.start);
        const cls = started ? 'past' : late ? 'late' : 'ok';
        const state = started ? 'Lesson has started' : late ? `Deadline passed (${nice(dl(d))})` : `Book by end of ${nice(dl(d))}`;
        const cur = editing && editing.date === d && editing.start === t.start;
        const label = `${DAYS[i]} ${nice(d)} ${t.start}–${t.end}, ${t.class} ${t.subject}, ${roomName(db, t.room)}. ${state}.${orders.length ? ' Already ordered: ' + orders.map(o => o.title).join(', ') + '.' : ''}`;
        grid += `<button class="lsn ${cls}${orders.length ? ' has' : ''}${cur ? ' cur' : ''}" style="grid-column:${2 + i};grid-row:${2 + slotOf(t.start)} / span ${Math.max(1, slotOf(t.end) - slotOf(t.start))}" ${started ? 'disabled' : ''} data-pick="${esc(d)}|${esc(t.start)}" aria-label="${esc(label)}">
          <span class="lt">${esc(t.start)}–${esc(t.end)} · ${esc(t.class)}</span>
          <span class="ls">${esc(t.subject)} · ${esc(roomName(db, t.room))}${isLabRoom(db, t.room) ? '' : ' (classroom)'}</span>
          ${orders.map(o => `<span class="ord">✓ ${esc(o.title)} <em>${esc({ draft: 'Draft', submitted: 'Submitted', accepted: 'Accepted', in_progress: 'In prep', ready: 'Ready', done: 'Done' }[o.status] || o.status)}</em></span>`).join('')}
          <span class="lstate">${started ? '' : late ? '✕ ' : '✓ '}${esc(state)}</span></button>`;
      });
    });
    grid += '</div>';
  }
  const weekLabel = `${mon.getDate()} ${mon.toLocaleDateString('en-GB', { month: 'short' })} – ${addDays(mon, 4).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;

  el.innerHTML = `<div class="page">
    <div><a href="${editing ? '#/order?id=' + esc(editing.id) : '#/' + (isTeacher ? 'home' : 'requests')}" class="small">‹ ${editing ? 'Back to the order' : isTeacher ? 'Back to home' : 'Back to the queue'}</a>
    <div class="steps-nav" aria-label="Steps"><span class="on">1 · Pick a lesson</span><span>2 · How to start</span><span>3 · Request</span></div>
    <h1 class="h1" style="margin-top:8px">${editing ? 'Move this order to another lesson' : isTeacher ? 'Which lesson is the practical for?' : 'Order a practical for a teacher'}</h1>
    <p class="lede">${isTeacher ? 'Your timetable' : 'Their timetable'}. Technicians need ${db.settings.leadDays} working days, so book by the end of the day shown on each lesson.</p></div>
    ${practical ? `<div class="note ok">Ordering <strong>${esc(practical.title)}</strong> from the library — now pick the lesson. <a href="${orderLink(q, { practical: null })}">Not this one</a></div>` : ''}
    ${!isTeacher ? `<label class="fld" style="max-width:320px">Teacher<select id="teacher"><option value="">Choose a teacher…</option>${teachers.map(t => `<option${t === teacher ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>` : ''}
    ${teacher ? `<section class="card flush">
      <div class="row between wrap" style="padding:14px 16px;border-bottom:1px solid var(--line)">
        <div class="row gap"><a class="icon-btn b" href="${orderLink(q, { w: w - 1 || null })}" aria-label="Previous week"${w === 0 ? ' aria-disabled="true" tabindex="-1" style="pointer-events:none;opacity:.4"' : ''}>‹</a>
          <strong style="font-size:16px;min-width:150px;text-align:center">${esc(weekLabel)}</strong>
          <a class="icon-btn b" href="${orderLink(q, { w: w + 1 })}" aria-label="Next week"${w >= MAX_WEEKS ? ' aria-disabled="true" tabindex="-1" style="pointer-events:none;opacity:.4"' : ''}>›</a>
          ${w ? `<a class="small" href="${orderLink(q, { w: null })}">This week</a>` : ''}</div>
        <div class="tt-legend"><span><i class="ok"></i>Can book on time</span><span><i class="late"></i>Deadline passed — late request</span><span><i class="past"></i>Already started</span><span><i class="has"></i>Practical ordered</span></div>
      </div>
      <div class="scroll">${mine.length ? grid : '<p class="empty">No lessons on the timetable for this teacher.</p>'}</div></section>
      <p class="muted small">Red lessons can still be requested, but the technicians decide whether they can prepare it in time.</p>` : ''}
  </div>`;

  const t = $('#teacher'); if (t) t.onchange = () => go(orderLink(q, { teacher: t.value, date: null, start: null }));
  el.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { const [date, start] = b.dataset.pick.split('|'); go(orderLink(q, { date, start, pick: null, teacher: isTeacher || editing ? null : teacher })); });
}

const formKey = (q, teacher) => q.get('id') || [teacher, q.get('date'), q.get('start'), q.get('practical'), q.get('mode')].join('|');
const libKit = (kit, sets) => kit.map(k => ({ itemId: k.itemId, name: k.name, perGroup: k.perGroup, fixed: !!k.fixed, qty: k.fixed ? k.perGroup : k.perGroup * sets }));

/* ---------------- step 2b: bring a practical from AI ---------------- */
function fromAI(el, q, teacher, l) {
  aiImport.render(el, {
    lesson: l, teacher, key: [teacher, l.date, l.start].join('|'),
    back: orderLink(q, { mode: null }), lessonCard: lessonCard(l, q, teacher),
    onUse: d => {
      const fq = new URLSearchParams(q.toString()); fq.set('mode', 'ai-form');
      S = { teacher, title: d.title, topic: d.topic, sets: d.sets, kit: d.kit, practicalId: '', notes: d.notes, lateChoice: '', fromAI: true, _for: formKey(fq, teacher) };
      go(orderLink(q, { mode: 'ai-form' }));
    }
  });
}

/* ---------------- step 2: how to start ---------------- */
function chooseStart(el, q, teacher, l) {
  const late = isLate(l.date, db.settings); const orders = ordersFor(teacher, l.date, l.start);
  const libForGrade = db.library.filter(p => Number(p.grade) === Number(l.grade || gradeOf(l.class))).length;
  el.innerHTML = `<div class="page" style="max-width:1100px">
    <div><a href="${orderLink(q, { date: null, start: null, mode: null })}" class="small">‹ Pick another lesson</a>
    <div class="steps-nav" aria-label="Steps"><span class="done">1 · Pick a lesson</span><span class="on">2 · How to start</span><span>3 · Request</span></div>
    <h1 class="h1" style="margin-top:8px">How do you want to start?</h1></div>
    ${lessonCard(l, q, teacher)}
    ${orders.length ? `<div class="note warn"><strong>Already ordered for this lesson:</strong> ${orders.map(o => `${esc(o.title)} (${esc(o.status === 'draft' ? 'draft' : o.status.replace('_', ' '))}) · <a href="#/order?id=${esc(o.id)}">open it</a>`).join(' · ')}. You can still order another one below.</div>` : ''}
    <div class="opts">
      <a class="opt" href="${orderLink(q, { mode: 'new' })}">
        <span class="opt-ic" aria-hidden="true">＋</span><strong>New lab request</strong>
        <span class="muted">Start from a blank form: name the practical and list the equipment and chemicals.</span>
        <span class="opt-go">Start a new request ›</span></a>
      <a class="opt" href="#/library?${new URLSearchParams({ order: orderLink(q).slice(1), grade: l.grade || gradeOf(l.class) || '' })}">
        <span class="opt-ic" aria-hidden="true">📚</span><strong>From the practical library</strong>
        <span class="muted">Reuse a practical we’ve run before. Its kit and number of sets are filled in, and you can edit or adapt anything before sending.${libForGrade ? ` ${libForGrade} for Grade ${esc(l.grade || gradeOf(l.class))}.` : ''}</span>
        <span class="opt-go">Browse the library ›</span></a>
      <a class="opt" href="${orderLink(q, { mode: 'ai' })}">
        <span class="row between" style="align-items:flex-start"><span class="opt-ic" aria-hidden="true">📋</span><span class="pill new">New</span></span><strong>Bring a practical from AI</strong>
        <span class="muted">Found a good PDF or idea? Copy our prompt into ChatGPT, Gemini or Claude with it, paste the answer back, and see what we have and what’s missing.</span>
        <span class="opt-go">Copy the prompt ›</span></a>
      <div class="opt locked" aria-disabled="true">
        <span class="row between" style="align-items:flex-start"><span class="opt-ic" aria-hidden="true">✨</span><span class="pill restricted">🔒 Coming soon</span></span><strong>Use AI to request this lab</strong>
        <span class="muted">Describe what you want students to do, and AI drafts the practical, equipment list and hazards for you to check.</span>
        <span class="opt-go muted">Not available yet</span></div>
    </div>
    ${late ? `<p class="muted small">This lesson is past the booking deadline. You can still request it — you’ll be asked whether to talk to the technicians first.</p>` : ''}
  </div>`;
}

function lessonCard(l, q, teacher, editing) {
  const late = isLate(l.date, db.settings);
  return `<section class="card lesson-sum">
    <div><div class="kicker">${session.me.role === 'teacher' ? 'Your lesson' : esc(teacher) + '’s lesson'}</div>
      <div class="ls-main">${esc(niceLong(l.date))} · ${esc(l.start)}–${esc(l.end)}</div>
      <div class="muted">${esc(l.class)} · ${esc(l.subject || '')} · ${esc(roomName(db, l.timetabledRoom || l.room))} (${isLabRoom(db, l.timetabledRoom || l.room) ? 'lab' : 'classroom'})</div></div>
    <div class="row gap wrap"><span class="pill ${late ? 'st-rejected' : 'st-ready'}">${late ? 'Deadline passed (' + esc(nice(dl(l.date))) + ')' : 'Book by end of ' + esc(nice(dl(l.date)))}</span>
      <a class="btn small" href="${orderLink(q, { date: null, start: null, mode: null, w: weekOffset(l.date) || null, pick: editing ? '1' : null })}">Change lesson</a></div>
  </section>`;
}
const weekOffset = date => Math.max(0, Math.round((monday(parse(date)) - monday(new Date())) / (7 * 864e5)));

/* ---------------- step 3: the request form ---------------- */
function form(el, q, editing, teacher, lesson) {
  const me = session.me;
  const key = formKey(q, teacher);
  if (!S || S._for !== key) {
    const p = q.get('practical') ? db.library.find(x => x.id === q.get('practical')) : null;
    S = editing ? JSON.parse(JSON.stringify(editing)) : { teacher, kit: [], sets: 6, title: p?.title || '', practicalId: p?.id || '', notes: '', lateChoice: '' };
    if (p && !editing) { const last = db.requests.filter(r => r.practicalId === p.id && Number(r.sets) > 0).sort((a, b) => b.date.localeCompare(a.date))[0]; if (last) S.sets = Number(last.sets);
      S.kit = libKit(p.kit, S.sets); }
    if (editing) S.kit.forEach(k => { k.perGroup = k.perGroup || Math.max(1, Math.round(k.qty / (S.sets || 1))); });
    S._for = key;
  }
  if (lesson && (S.date !== lesson.date || S.start !== lesson.start)) {
    Object.assign(S, { date: lesson.date, start: lesson.start, end: lesson.end, class: lesson.class, grade: lesson.grade, subject: lesson.subject, room: lesson.room, timetabledRoom: lesson.room, lateChoice: '' });
  }
  const cur = { date: S.date, start: S.start, end: S.end };
  const late = isLate(cur.date, db.settings);
  const inClassroom = !isLabRoom(db, S.timetabledRoom || S.room);
  const labs = inClassroom ? labStatus(db, cur.date, cur.start, cur.end, S.id) : [];
  const techs = db.users.filter(u => u.role === 'technician' && String(u.email).includes('@')).map(u => u.email);
  const hz = hazcardsFor(db, S.kit);
  const clash = clashes(db, { ...S, kit: S.kit });
  const lib = db.library.slice().sort((a, b) => a.title.localeCompare(b.title));
  const fromLib = S.practicalId && db.library.find(p => p.id === S.practicalId);
  const back = editing ? (me.role === 'teacher' ? '#/home' : '#/requests/' + editing.id) : q.get('mode') === 'ai-form' ? orderLink(q, { mode: 'ai' }) : orderLink(q, { mode: null, practical: null });

  el.innerHTML = `<div class="page">
    <div><a href="${back}" class="small">‹ ${editing ? 'Back' : 'Back to how to start'}</a>
    ${editing ? '' : '<div class="steps-nav" aria-label="Steps"><span class="done">1 · Pick a lesson</span><span class="done">2 · How to start</span><span class="on">3 · Request</span></div>'}
    <h1 class="h1" style="margin-top:8px">${editing ? 'Change your order' : 'Order a practical'}</h1>
    <p class="lede">Technicians need ${db.settings.leadDays} working days. Today is ${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}.</p></div>
    ${late && !S.lateChoice ? `<section class="banner bad" role="alert"><div class="kicker">Late booking</div>
      <p><strong>Practicals on ${esc(nice(cur.date))} had to be booked by the end of ${esc(nice(dl(cur.date)))}.</strong> The technicians may not be able to prepare it in time.</p>
      <div class="row gap wrap"><button class="btn danger-solid" data-late="talk">Talk to the technicians first</button><button class="btn danger-outline" data-late="draft">Make a draft anyway, then talk to them</button></div></section>` : ''}
    ${late && S.lateChoice === 'talk' ? `<section class="banner bad"><div class="kicker">Late booking · talk first</div>
      <p>Your order stays a draft until you send it. Contact the technicians:</p>
      <div class="row gap wrap">${techs.length ? `<a class="btn danger-solid" href="mailto:${esc(techs.join(','))}?subject=${encodeURIComponent('Late practical request: ' + (S.title || 'practical') + ' ' + nice(cur.date))}&body=${encodeURIComponent(`Hi, I missed the booking deadline. Could you manage "${S.title || '…'}" for ${S.class} on ${nice(cur.date)} ${cur.start} in ${S.room} (${S.sets} sets)?`)}">Email the technicians</a>` : '<span class="muted">Speak to them in the prep room.</span>'}
      <button class="btn danger-outline" data-late="draft">Make a draft anyway instead</button></div></section>` : ''}
    ${late && S.lateChoice === 'draft' ? `<div class="note warn"><strong>Late request.</strong> It will show as late on the technicians’ board. They can accept, change the day or time, or reject it. Please talk to them too.</div>` : ''}

    <div class="cols">
      <form class="main-col" id="of" onsubmit="return false">
        ${lessonCard(S, editing ? new URLSearchParams({ id: editing.id }) : q, S.teacher, editing)}
        ${inClassroom ? `<section class="card stack"><h2 class="h2">Pick a lab</h2>
          <div class="note warn">This lesson is in <strong>${esc(roomName(db, S.timetabledRoom))}</strong>, a classroom. Choose a lab for the practical:</div>
          <div class="labs" role="radiogroup" aria-label="Lab">${labs.map(l => `<button type="button" role="radio" aria-checked="${S.room === l.room}" class="labrow${S.room === l.room ? ' on' : ''}" data-lab="${esc(l.room)}" ${l.state === 'practical' ? 'disabled' : ''}>
            <strong>${esc(l.room)}</strong><span class="muted small">${esc(l.name)}</span>
            <span class="pill ${l.state === 'free' ? 'st-ready' : l.state === 'lesson' ? 'warn' : 'st-rejected'}">${{ free: 'Free', lesson: 'Lesson, no practical', practical: 'Practical booked' }[l.state]}</span>
            <span class="small grow">${l.state === 'free' ? 'Nobody in this lab' : 'Booked by ' + esc(l.who) + ' · ' + esc(l.cls) + (l.title ? ' · ' + esc(l.title) : '')}</span></button>`).join('')}
            <button type="button" class="labrow${S.room === S.timetabledRoom ? ' on' : ''}" data-lab="${esc(S.timetabledRoom)}"><strong>${esc(S.timetabledRoom)}</strong><span class="muted small">Stay in the classroom</span><span class="pill">Demo / no wet work</span><span></span></button></div>
          <p class="muted small">Free: book it. Lesson, no practical: ask that teacher to swap rooms. Practical booked: not available.</p></section>` : ''}

        <section class="card stack">
          <div class="row between wrap"><h2 class="h2">Practical and equipment</h2>${!editing ? `<a class="small" href="#/library?${new URLSearchParams({ order: orderLink(q, { mode: null, practical: null }).slice(1), grade: S.grade || gradeOf(S.class) || '' })}">Pick from the library instead</a>` : ''}</div>
          ${S.fromAI ? `<div class="note ok">Planned with AI. Check the quantities and the notes (method, safety, disposal) before you send it — it’s your request.</div>` : ''}
          ${unavailable(db, S).length ? `<div class="note warn"><strong>We don’t have ${unavailable(db, S).length === 1 ? 'this' : 'these'}:</strong> ${unavailable(db, S).map(u => esc(u.name)).join(', ')}. You can still send the request — the technicians will try to order or borrow ${unavailable(db, S).length === 1 ? 'it' : 'them'}, or suggest a swap. Leave enough time.</div>` : ''}
          ${fromLib ? `<div class="note ok">From the library: <strong>${esc(fromLib.title)}</strong>. The kit and sets are from last time — change anything you need.</div>` : ''}
          <div class="grid2"><label class="fld">Practical<select id="practical"><option value="">— New practical (type the name below) —</option>${lib.map(p => `<option value="${esc(p.id)}"${p.id === S.practicalId ? ' selected' : ''}>${esc(p.title)} · G${esc(p.grade)} ${esc(p.subject)}</option>`).join('')}</select></label>
          <label class="fld">Number of sets<input id="sets" type="number" min="1" max="40" value="${esc(S.sets)}"></label></div>
          <label class="fld"${S.practicalId ? ' hidden' : ''}>Practical name<input id="title" value="${esc(S.title)}" required placeholder="e.g. Sound waves on an oscilloscope"></label>
          <div class="scroll"><table class="tbl"><thead><tr><th>Item</th><th>Per group</th><th>Needed</th><th>Free at that time</th><th></th></tr></thead><tbody>
          ${S.kit.map((k, i) => { const it = db.inventory.find(x => x.id === k.itemId); const c = clash.find(x => x.item.id === k.itemId);
            const free = !it ? '<span class="bad-t">Not in our inventory</span>' : it.list !== 'Equipment' ? '<span class="muted">—</span>' : c ? `<span class="bad-t">Only ${Math.max(0, c.have - c.used)} of ${c.have} free</span>` : '<span class="ok-t strong">Free</span>';
            return `<tr><td>${esc(k.name)}${it?.hazcards?.length ? ` <span class="pill danger">Hazcard ${esc(it.hazcards.join(', '))}</span>` : ''}</td>
            <td>${k.fixed ? '<span class="muted small">teacher only</span>' : `<input class="num" type="number" min="0" step="any" value="${esc(k.perGroup)}" data-pg="${i}" aria-label="Per group">`}</td><td class="strong">${esc(k.qty)}</td><td>${free}</td>
            <td><button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove ${esc(k.name)}">×</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No items yet — add the equipment and chemicals you need.</td></tr>'}
          </tbody></table></div>
          <div class="add-row"><input id="addItem" list="invList" placeholder="Type to search the inventory…" aria-label="Equipment to add"><datalist id="invList">${db.inventory.map(i => `<option value="${esc(i.name + (i.size ? ' · ' + i.size : '') + ' [' + i.id + ']')}">`).join('')}</datalist><button type="button" class="btn" id="addBtn">+ Add equipment</button></div>
          <label class="fld">Notes for the technicians<textarea id="notes" rows="2">${esc(S.notes)}</textarea></label>
        </section>
      </form>

      <aside class="side-col sticky">
        <section class="card pad-s" style="padding:20px 22px"><h2 class="h2" style="margin-bottom:8px">Checks</h2><ul class="checks">
          ${late ? `<li class="bad-t">! Late: deadline was end of ${esc(nice(dl(cur.date)))}</li>` : `<li class="ok-t">✓ On time: book by end of ${esc(nice(dl(cur.date)))}</li>`}
          <li class="ok-t">✓ Matches your timetable</li>
          ${inClassroom && S.room === S.timetabledRoom ? '<li class="warn-t">! Lesson is in a classroom — pick a lab</li>' : `<li class="ok-t">✓ ${inClassroom ? 'Moved to a lab' : 'Lesson is in a lab'} (${esc(roomName(db, S.room))})</li>`}
          ${clash.length ? `<li class="bad-t">! ${clash.length} equipment clash${clash.length > 1 ? 'es' : ''}</li>` : S.kit.length ? '<li class="ok-t">✓ Equipment free</li>' : '<li class="warn-t">! Add the equipment</li>'}
          ${unavailable(db, S).length ? `<li class="warn-t">! ${unavailable(db, S).length} item${unavailable(db, S).length > 1 ? 's' : ''} we don’t have — technicians will source</li>` : ''}
          ${hz.length ? `<li class="warn-t">! ${hz.length} hazcard${hz.length > 1 ? 's' : ''} to read</li>` : ''}
          ${S.title ? '' : '<li class="warn-t">! Name the practical</li>'}
        </ul></section>
        <button class="btn pri big block" id="submit" ${!S.title || !S.kit.length || (late && S.lateChoice !== 'draft') ? 'disabled' : ''}>${late ? 'Send late request' : editing && editing.status !== 'draft' ? 'Send changes' : 'Submit to technicians'}</button>
        <button class="btn big block" id="draft" ${!S.title ? 'disabled' : ''}>Save as draft</button>
        <div class="opt locked mini" aria-disabled="true"><span class="row between"><strong>✨ Use AI to fill this in</strong><span class="pill restricted">🔒 Coming soon</span></span><span class="muted xs">AI will suggest the equipment, quantities and hazards for you to check.</span></div>
      </aside>
    </div></div>`;

  const sync = () => { S.title = $('#title').value; S.sets = Math.max(1, Number($('#sets').value) || 1); S.notes = $('#notes').value; S.kit.forEach(k => { if (!k.fixed) k.qty = round(k.perGroup * S.sets); }); };
  const rerender = () => { sync(); form(el, q, editing, teacher, lesson); };
  el.querySelectorAll('[data-lab]').forEach(b => b.onclick = () => { S.room = b.dataset.lab; rerender(); });
  el.querySelectorAll('[data-late]').forEach(b => b.onclick = () => { S.lateChoice = b.dataset.late; rerender(); });
  $('#practical').onchange = e => { const p = db.library.find(x => x.id === e.target.value); sync();
    if (p) { S.practicalId = p.id; S.title = p.title; S.kit = libKit(p.kit, S.sets); } else { S.practicalId = ''; S.title = ''; } form(el, q, editing, teacher, lesson); };
  // redraw after the event finishes, so a blur fired while the old inputs are removed can't redraw twice
  const later = f => setTimeout(f, 0);
  $('#sets').onchange = () => later(rerender);
  el.querySelectorAll('[data-pg]').forEach(inp => inp.onchange = () => { S.kit[Number(inp.dataset.pg)].perGroup = Number(inp.value) || 0; later(() => { rerender(); checkClash(); }); });
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { S.kit.splice(Number(b.dataset.rm), 1); rerender(); });
  const add = () => { const v = $('#addItem').value.trim(); const m = v.match(/\[([^\]]+)\]$/); const it = m && db.inventory.find(i => i.id === m[1]);
    if (!v) return;
    if (!it) { // something we don't have: the teacher can still ask for it
      modal(`<h2 class="h2">“${esc(v)}” isn’t in our inventory</h2><p>Pick it from the list if we have it under another name. Otherwise you can still ask for it — the technicians will try to order or borrow it, or suggest a swap.</p>
        <div class="row end gap wrap"><button class="btn" data-close>Search again</button><button class="btn pri" id="addMissing">Ask for it anyway</button></div>`);
      $('#addMissing').onclick = () => { closeModal(); sync(); S.kit.push({ itemId: '', name: v + ' — not in our inventory', perGroup: 1, qty: S.sets }); form(el, q, editing, teacher, lesson); };
      return;
    }
    sync(); S.kit.push({ itemId: it.id, name: it.name + (it.size ? ' ' + it.size : ''), perGroup: 1, qty: S.sets }); form(el, q, editing, teacher, lesson); checkClash(it.id); };
  $('#addBtn').onclick = add; $('#addItem').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  $('#draft').onclick = () => save('draft');
  $('#submit').onclick = async () => {
    sync(); const cards = hazcardsFor(db, S.kit);
    if (cards.length && !(await hazcardModal(cards, `READ BEFORE ORDERING · ${cards.length} HAZCARD${cards.length > 1 ? 'S' : ''}`, 'I’ve read these — send'))) return;
    save('submitted');
  };

  function checkClash(itemId) {
    const c = clashes(db, S).filter(x => !itemId || x.item.id === itemId); if (!c.length) return;
    modal(`<div class="kicker danger">POSSIBLE EQUIPMENT CLASH</div>
      ${c.map(x => `<h2 class="h2">${esc(x.item.name)} — ${x.have} in stock, ${x.used} already booked</h2>
        <ul>${x.others.map(o => `<li>${esc(o.r.teacher)} · ${esc(o.r.class)} · ${esc(o.r.title)} · ${esc(o.r.start)}–${esc(o.r.end)} (${o.q})</li>`).join('')}</ul>`).join('')}
      <p class="muted small">The technicians will see this clash too.</p>
      <div class="stack"><button class="btn" data-close>Keep it — the technicians will decide</button><a class="btn" id="pickTime" href="${orderLink(editing ? new URLSearchParams({ id: editing.id }) : q, { date: null, start: null, mode: null, pick: editing ? '1' : null })}">Pick another lesson</a></div>`);
    $('#pickTime').onclick = () => closeModal();
  }

  async function save(status) {
    sync();
    const r = { ...S }; delete r._for; delete r.topic; delete r.fromAI; r.status = status; r.late = !!late;
    r.kit = S.kit.map(({ itemId, name, qty }) => ({ itemId, name, qty }));
    r.prep = r.prep || 0;
    try {
      if (!r.practicalId && status !== 'draft') {
        const p = await call('upsert', { table: 'Library', row: { title: r.title, grade: r.grade, subject: r.subject, course: '', topic: S.topic || '', kit: S.kit.map(k => k.fixed ? { itemId: k.itemId, name: k.name, perGroup: k.qty, fixed: true } : { itemId: k.itemId, name: k.name, perGroup: k.perGroup }), prepMinutes: '', method: '' } });
        r.practicalId = p.id;
      }
      await call('saveRequest', { request: r });
      S = null; toast(status === 'draft' ? 'Draft saved' : 'Sent to the technicians'); await reload(); go(session.me.role === 'teacher' ? '#/home' : '#/requests');
    } catch (e) { toast('Could not save: ' + e.message, 'bad'); }
  }
}
const round = n => Math.round(n * 100) / 100;
