import { db, session, call } from '../store.js';
import { esc, nice, deadline, isLate, upcomingLessons, isLabRoom, labStatus, clashes, hazcardsFor, roomName, totalStock, iso } from '../logic.js';
import { $, modal, closeModal, toast, hazcardModal } from '../ui.js';
import { go, reload } from '../app.js';

let S = null; // form state

export async function render(el, _rest, q) {
  const me = session.me;
  const editing = q.get('id') ? db.requests.find(r => r.id === q.get('id')) : null;
  if (!S || S._for !== (q.get('id') || q.get('practical') || 'new')) {
    const p = q.get('practical') ? db.library.find(x => x.id === q.get('practical')) : null;
    S = editing ? JSON.parse(JSON.stringify(editing)) : { teacher: me.role === 'teacher' ? me.name : '', kit: [], sets: 6, title: p?.title || '', practicalId: p?.id || '', notes: '', lateChoice: '' };
    if (p && !editing) S.kit = p.kit.map(k => ({ itemId: k.itemId, name: k.name, perGroup: k.perGroup, qty: k.perGroup * S.sets }));
    if (editing) S.kit.forEach(k => { k.perGroup = k.perGroup || Math.max(1, Math.round(k.qty / (S.sets || 1))); });
    S._for = q.get('id') || q.get('practical') || 'new';
  }
  const teachers = [...new Set(db.timetable.map(t => t.teacher))].sort();
  const lessons = S.teacher ? upcomingLessons(db, S.teacher, 5) : [];
  if (S.date && !lessons.some(l => l.date === S.date && l.start === S.start) && S.class) lessons.unshift({ date: S.date, start: S.start, end: S.end, class: S.class, room: S.timetabledRoom || S.room, subject: S.subject, grade: S.grade });
  const cur = S.date ? { date: S.date, start: S.start, end: S.end } : null;
  const late = cur && isLate(cur.date, db.settings);
  const inClassroom = cur && !isLabRoom(db, S.timetabledRoom || S.room);
  const labs = inClassroom ? labStatus(db, cur.date, cur.start, cur.end, S.id) : [];
  const techs = db.users.filter(u => u.role === 'technician' && u.email).map(u => u.email);
  const hz = hazcardsFor(db, S.kit);
  const clash = cur ? clashes(db, { ...S, kit: S.kit }) : [];
  const lib = db.library.slice().sort((a, b) => a.title.localeCompare(b.title));

  el.innerHTML = `<div class="page">
    <a href="#/${me.role === 'teacher' ? 'home' : 'requests'}" class="small">‹ Back</a>
    <h1 class="h1">${editing ? 'Change your order' : 'Order a practical'}</h1>
    <p class="muted">Technicians need ${db.settings.leadDays} working days. Every field is needed so they get a complete request.</p>
    ${late && !S.lateChoice ? `<section class="banner bad" role="alert"><div class="kicker">LATE BOOKING</div>
      <p><strong>Practicals on ${esc(nice(cur.date))} had to be booked by the end of ${esc(nice(deadline(cur.date, db.settings.leadDays, db.settings.holidays)))}.</strong> The technicians may not be able to prepare it in time.</p>
      <div class="row gap wrap"><button class="btn danger-solid" data-late="talk">Talk to the technicians first</button><button class="btn danger-outline" data-late="draft">Make a draft anyway, then talk to them</button></div></section>` : ''}
    ${late && S.lateChoice === 'talk' ? `<section class="banner bad"><div class="kicker">LATE BOOKING · TALK FIRST</div>
      <p>Your order stays a draft until you send it. Contact the technicians:</p>
      <div class="row gap wrap">${techs.length ? `<a class="btn pri" href="mailto:${esc(techs.join(','))}?subject=${encodeURIComponent('Late practical request: ' + (S.title || 'practical') + ' ' + nice(cur.date))}&body=${encodeURIComponent(`Hi, I missed the booking deadline. Could you manage "${S.title || '…'}" for ${S.class} on ${nice(cur.date)} ${cur.start} in ${S.room} (${S.sets} sets)?`)}">Email the technicians</a>` : '<span class="muted">Speak to them in the prep room.</span>'}
      <button class="btn" data-late="draft">Make a draft anyway instead</button></div></section>` : ''}
    ${late && S.lateChoice === 'draft' ? `<div class="note warn"><strong>Late request.</strong> It will show as late on the technicians’ board. They can accept, change the day or time, or reject it. Please talk to them too.</div>` : ''}

    <div class="cols">
      <form class="grow stack" id="of" onsubmit="return false">
        <section class="card stack">
          <h2 class="h2">1 · Lesson</h2>
          ${me.role !== 'teacher' ? `<label class="fld">Teacher<select id="teacher"><option value="">Choose…</option>${teachers.map(t => `<option${t === S.teacher ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>` : ''}
          ${S.teacher ? (lessons.length ? `<div class="lessons" role="radiogroup" aria-label="Lesson">${lessons.slice(0, 40).map((l, i) => {
            const lt = isLate(l.date, db.settings); const on = l.date === S.date && l.start === S.start;
            return `<button type="button" role="radio" aria-checked="${on}" class="lesson${on ? ' on' : ''}" data-lesson="${i}">
              <span><strong>${esc(nice(l.date))} · ${esc(l.start)}–${esc(l.end)}</strong><span class="muted small">${esc(l.class)} · ${esc(l.subject || '')} · ${esc(roomName(db, l.room))}${isLabRoom(db, l.room) ? '' : ' (classroom)'}</span></span>
              <span class="pill ${lt ? 'st-rejected' : 'st-ready'}">${lt ? 'Deadline passed' : 'Book by ' + esc(nice(deadline(l.date, db.settings.leadDays, db.settings.holidays)))}</span></button>`; }).join('')}</div>` : '<p class="muted">No lessons found on the timetable for this teacher.</p>') : ''}
          ${inClassroom ? `<div class="note warn small">This lesson is in <strong>${esc(roomName(db, S.timetabledRoom))}</strong>, a classroom. Pick a lab:</div>
            <div class="labs" role="radiogroup" aria-label="Lab">${labs.map(l => `<button type="button" role="radio" aria-checked="${S.room === l.room}" class="labrow${S.room === l.room ? ' on' : ''}" data-lab="${esc(l.room)}" ${l.state === 'practical' ? 'disabled' : ''}>
              <strong>${esc(l.room)}</strong><span class="muted small">${esc(l.name)}</span>
              <span class="pill ${l.state === 'free' ? 'st-ready' : l.state === 'lesson' ? 'st-accepted-warn' : 'st-rejected'}">${{ free: 'Free', lesson: 'Lesson, no practical', practical: 'Practical booked' }[l.state]}</span>
              <span class="small grow">${l.state === 'free' ? 'Nobody in this lab' : 'Booked by ' + esc(l.who) + ' · ' + esc(l.cls) + (l.title ? ' · ' + esc(l.title) : '')}</span></button>`).join('')}
              <button type="button" class="labrow${S.room === S.timetabledRoom ? ' on' : ''}" data-lab="${esc(S.timetabledRoom)}"><strong>${esc(S.timetabledRoom)}</strong><span class="muted small">Stay in the classroom</span><span class="pill">Demo / no wet work</span><span></span></button></div>
            <p class="muted small">Free: book it. Lesson, no practical: ask that teacher to swap rooms. Practical booked: not available.</p>` : ''}
        </section>

        <section class="card stack">
          <h2 class="h2">2 · Practical</h2>
          <label class="fld">From the library<select id="practical"><option value="">— New practical (type the name below) —</option>${lib.map(p => `<option value="${esc(p.id)}"${p.id === S.practicalId ? ' selected' : ''}>${esc(p.title)} · G${esc(p.grade)} ${esc(p.subject)}</option>`).join('')}</select></label>
          <div class="grid2"><label class="fld">Practical name<input id="title" value="${esc(S.title)}" required></label>
          <label class="fld">Number of sets (groups)<input id="sets" type="number" min="1" max="40" value="${esc(S.sets)}"></label></div>
        </section>

        <section class="card stack">
          <div class="row between"><h2 class="h2">3 · Equipment and chemicals</h2><span class="muted small">per group × sets</span></div>
          <div class="scroll"><table class="tbl"><thead><tr><th>Item</th><th>Per group</th><th>Total</th><th>Free at that time</th><th></th></tr></thead><tbody>
          ${S.kit.map((k, i) => { const it = db.inventory.find(x => x.id === k.itemId); const c = clash.find(x => x.item.id === k.itemId);
            const free = !it ? '' : it.list !== 'Equipment' ? '<span class="muted">chemical / consumable</span>' : c ? `<span class="bad-t">${Math.max(0, c.have - c.used)} of ${c.have} free</span>` : `<span class="ok-t">${totalStock(it)} in stock</span>`;
            return `<tr><td>${esc(k.name)}${it?.hazcards?.length ? ` <span class="pill danger small">Hazcard ${esc(it.hazcards.join(', '))}</span>` : ''}</td>
            <td><input class="num" type="number" min="0" step="any" value="${esc(k.perGroup)}" data-pg="${i}" aria-label="Per group"></td><td>${esc(k.qty)}</td><td>${free}</td>
            <td><button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove ${esc(k.name)}">×</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No items yet.</td></tr>'}
          </tbody></table></div>
          <div class="row gap wrap"><input id="addItem" list="invList" placeholder="Add an item: type to search the inventory…" class="grow"><datalist id="invList">${db.inventory.map(i => `<option value="${esc(i.name + (i.size ? ' · ' + i.size : '') + ' [' + i.id + ']')}">`).join('')}</datalist><button type="button" class="btn" id="addBtn">Add</button></div>
          <label class="fld">Notes for the technicians<textarea id="notes" rows="2">${esc(S.notes)}</textarea></label>
        </section>
      </form>

      <aside class="side stack">
        <section class="card"><h2 class="h2">Checks</h2><ul class="checks">
          ${!cur ? '<li class="warn-t">! Pick a lesson</li>' : late ? `<li class="bad-t">! Late: deadline was end of ${esc(nice(deadline(cur.date, db.settings.leadDays, db.settings.holidays)))}</li>` : `<li class="ok-t">✓ On time: book by end of ${esc(nice(deadline(cur.date, db.settings.leadDays, db.settings.holidays)))}</li>`}
          ${cur ? (inClassroom && S.room === S.timetabledRoom ? '<li class="warn-t">! Lesson is in a classroom</li>' : `<li class="ok-t">✓ Room: ${esc(roomName(db, S.room))}</li>`) : ''}
          ${clash.length ? `<li class="bad-t">! ${clash.length} equipment clash${clash.length > 1 ? 'es' : ''}</li>` : cur && S.kit.length ? '<li class="ok-t">✓ Equipment free</li>' : ''}
          ${hz.length ? `<li class="warn-t">! ${hz.length} hazcard${hz.length > 1 ? 's' : ''} to read</li>` : ''}
          ${S.title ? '' : '<li class="warn-t">! Name the practical</li>'}
        </ul></section>
        <button class="btn pri big" id="submit" ${!cur || !S.title || !S.kit.length || (late && S.lateChoice !== 'draft') ? 'disabled' : ''}>${late ? 'Send late request' : editing && editing.status !== 'draft' ? 'Send changes' : 'Submit to technicians'}</button>
        <button class="btn big" id="draft" ${!S.title ? 'disabled' : ''}>Save as draft</button>
      </aside>
    </div></div>`;

  const sync = () => { S.title = $('#title').value; S.sets = Math.max(1, Number($('#sets').value) || 1); S.notes = $('#notes').value; S.kit.forEach(k => k.qty = round(k.perGroup * S.sets)); };
  const rerender = () => { sync(); render(el, _rest, q); };
  const t = $('#teacher'); if (t) t.onchange = () => { S.teacher = t.value; S.date = null; rerender(); };
  el.querySelectorAll('[data-lesson]').forEach(b => b.onclick = () => { const l = lessons[Number(b.dataset.lesson)];
    Object.assign(S, { date: l.date, start: l.start, end: l.end, class: l.class, grade: l.grade, subject: l.subject, room: l.room, timetabledRoom: l.room, lateChoice: S.lateChoice && isLate(l.date, db.settings) ? S.lateChoice : '' }); rerender(); });
  el.querySelectorAll('[data-lab]').forEach(b => b.onclick = () => { S.room = b.dataset.lab; rerender(); });
  el.querySelectorAll('[data-late]').forEach(b => b.onclick = () => { S.lateChoice = b.dataset.late; rerender(); });
  $('#practical').onchange = e => { const p = db.library.find(x => x.id === e.target.value); sync();
    if (p) { S.practicalId = p.id; S.title = p.title; S.kit = p.kit.map(k => ({ itemId: k.itemId, name: k.name, perGroup: k.perGroup, qty: k.perGroup * S.sets })); } else S.practicalId = ''; render(el, _rest, q); };
  $('#sets').onchange = rerender;
  el.querySelectorAll('[data-pg]').forEach(inp => inp.onchange = () => { S.kit[Number(inp.dataset.pg)].perGroup = Number(inp.value) || 0; rerender(); checkClash(); });
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { S.kit.splice(Number(b.dataset.rm), 1); rerender(); });
  const add = () => { const v = $('#addItem').value; const m = v.match(/\[([^\]]+)\]$/); const it = m && db.inventory.find(i => i.id === m[1]);
    if (!it) { toast('Pick an item from the list', 'bad'); return; }
    sync(); S.kit.push({ itemId: it.id, name: it.name + (it.size ? ' ' + it.size : ''), perGroup: 1, qty: S.sets }); render(el, _rest, q); checkClash(it.id); };
  $('#addBtn').onclick = add; $('#addItem').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  $('#draft').onclick = () => save('draft');
  $('#submit').onclick = async () => {
    sync(); const cards = hazcardsFor(db, S.kit);
    if (cards.length && !(await hazcardModal(cards, `READ BEFORE ORDERING · ${cards.length} HAZCARD${cards.length > 1 ? 'S' : ''}`, 'I’ve read these — send'))) return;
    save('submitted');
  };

  function checkClash(itemId) {
    if (!cur) return; const c = clashes(db, S).filter(x => !itemId || x.item.id === itemId); if (!c.length) return;
    modal(`<div class="kicker danger">POSSIBLE EQUIPMENT CLASH</div>
      ${c.map(x => `<h2 class="h2">${esc(x.item.name)} — ${x.have} in stock, ${x.used} already booked</h2>
        <ul>${x.others.map(o => `<li>${esc(o.r.teacher)} · ${esc(o.r.class)} · ${esc(o.r.title)} · ${esc(o.r.start)}–${esc(o.r.end)} (${o.q})</li>`).join('')}</ul>`).join('')}
      <p class="muted small">The technicians will see this clash too.</p>
      <div class="stack"><button class="btn" data-close>Keep it — the technicians will decide</button><button class="btn" id="pickTime">Pick another lesson</button></div>`);
    $('#pickTime').onclick = () => { closeModal(); document.querySelector('.lessons')?.scrollIntoView({ behavior: 'smooth' }); };
  }

  async function save(status) {
    sync();
    const r = { ...S }; delete r._for; r.status = status; r.late = !!late && status !== 'draft' ? true : !!late;
    r.kit = S.kit.map(({ itemId, name, qty }) => ({ itemId, name, qty }));
    r.prep = r.prep || 0;
    try {
      if (!r.practicalId && status !== 'draft') {
        const p = await call('upsert', { table: 'Library', row: { title: r.title, grade: r.grade, subject: r.subject, course: '', topic: '', kit: S.kit.map(k => ({ itemId: k.itemId, name: k.name, perGroup: k.perGroup })), prepMinutes: '', method: '' } });
        r.practicalId = p.id;
      }
      await call('saveRequest', { request: r });
      S = null; toast(status === 'draft' ? 'Draft saved' : 'Sent to the technicians'); await reload(); go(session.me.role === 'teacher' ? '#/home' : '#/requests');
    } catch (e) { toast('Could not save: ' + e.message, 'bad'); }
  }
}
const round = n => Math.round(n * 100) / 100;
