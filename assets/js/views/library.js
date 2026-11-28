import { db, session, call } from '../store.js';
import { esc, nice, iso, hazcardsFor, roomName, toCSV, gradesOf, gradeLabel } from '../logic.js';
import { $, hazcardModal, promptBox, toast, confirmBox, download } from '../ui.js';
import { go, reload } from '../app.js';

const st = { grade: 'All', subject: 'All', topic: 'All', q: '', sel: null };

export async function render(el, _rest, params = new URLSearchParams()) {
  const orderCtx = params.get('order'); // set when a teacher is choosing a practical for a lesson (#/order step 2)
  if (orderCtx && st._ctx !== orderCtx) { st._ctx = orderCtx; const g = Number(params.get('grade')); st.grade = g && db.library.some(p => gradesOf(p).includes(g)) ? g : 'All'; st.subject = 'All'; st.topic = 'All'; st.q = ''; st.sel = null; }
  const ctxLesson = (() => { if (!orderCtx) return null; const p = new URLSearchParams(orderCtx.split('?')[1] || ''); const t = p.get('teacher') || session.me.name;
    const l = db.timetable.find(x => x.teacher === t && x.start === p.get('start') && x.day === ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(p.get('date') + 'T12:00').getDay()]);
    return l ? { ...l, date: p.get('date') } : null; })();
  const runs = id => db.requests.filter(r => r.practicalId === id && !['draft', 'cancelled', 'rejected'].includes(r.status)).sort((a, b) => b.date.localeCompare(a.date));
  const sortAZ = a => [...new Set(a.filter(Boolean))].sort((x, y) => String(x).localeCompare(String(y)));
  // each dropdown only offers what exists for the choices made before it
  const grades = [...new Set(db.library.flatMap(gradesOf))].sort((a, b) => a - b);
  const byGrade = db.library.filter(p => st.grade === 'All' || gradesOf(p).includes(st.grade));
  const subjects = sortAZ(byGrade.map(p => p.subject));
  if (st.subject !== 'All' && !subjects.includes(st.subject)) st.subject = 'All';
  const bySubject = byGrade.filter(p => st.subject === 'All' || p.subject === st.subject);
  const topics = sortAZ(bySubject.map(p => p.topic));
  if (st.topic !== 'All' && !topics.includes(st.topic)) st.topic = 'All';
  const words = st.q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = bySubject.filter(p => (st.topic === 'All' || p.topic === st.topic) &&
    words.every(w => (p.title + ' ' + (p.topic || '') + ' ' + p.subject + ' ' + (p.course || '')).toLowerCase().includes(w)))
    .sort((a, b) => (gradesOf(a)[0] || 99) - (gradesOf(b)[0] || 99) || a.title.localeCompare(b.title));
  const sel = list.find(p => p.id === st.sel) || list[0];
  const canEdit = session.me.role !== 'teacher';
  const lastRun = p => runs(p.id)[0];
  const opt = (v, label, cur) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
  el.innerHTML = `<div class="page">
    <header class="page-head"><div><h1 class="h1">Practical library</h1><p class="lede">${db.library.length} practicals. Choose a grade and subject, then pick one to see its kit.</p></div>
    <div class="row gap wrap">${session.me.role === 'admin' ? '<a class="btn" href="#/admin/data">Import</a>' : ''}${canEdit ? '<button class="btn" id="newP">+ Add practical</button>' : ''}<button class="btn" id="expP">Export</button></div></header>
    ${orderCtx ? `<div class="note ok row between wrap"><span>Choosing a practical for ${ctxLesson ? `<strong>${esc(ctxLesson.class)} · ${esc(nice(ctxLesson.date))} ${esc(ctxLesson.start)}</strong>` : 'your lesson'}. Pick one, then press <strong>Use for this lesson</strong> — you can edit or adapt it next.</span><a class="btn small" href="#${esc(orderCtx)}">‹ Back</a></div>` : ''}
    <div class="lib-filters">
      <label class="fld">Grade<select id="fg">${opt('All', 'All grades', st.grade)}${grades.map(g => opt(g, 'Grade ' + g, st.grade)).join('')}</select></label>
      <label class="fld">Subject<select id="fs">${opt('All', 'All subjects', st.subject)}${subjects.map(x => opt(x, x, st.subject)).join('')}</select></label>
      <label class="fld">Topic<select id="ft">${opt('All', 'All topics', st.topic)}${topics.map(x => opt(x, x, st.topic)).join('')}</select></label>
      <label class="fld grow">Search<input id="q" type="search" placeholder="e.g. titration, osmosis, density" value="${esc(st.q)}"></label>
    </div>
    <div class="lib-split">
      <section class="plist pane-l" aria-label="Practicals">
        <div class="plist-head">${list.length} practical${list.length === 1 ? '' : 's'}${st.grade !== 'All' || st.subject !== 'All' || st.topic !== 'All' || st.q ? ' · <button class="linkbtn" id="clr">Clear filters</button>' : ''}</div>
        ${list.map(p => `<button class="prow${sel && p.id === sel.id ? ' on' : ''}" data-p="${esc(p.id)}" aria-pressed="${!!sel && p.id === sel.id}">
          <span class="pt">${esc(p.title)}</span>
          <span class="pm">${[gradeLabel(p), p.subject, p.topic].filter(Boolean).map(esc).join(' · ')}</span>
          <span class="pk${p.kit.length ? '' : ' none'}">${p.kit.length ? p.kit.length + ' items' : 'No kit yet'}</span></button>`).join('') || '<p class="muted" style="padding:16px">No practicals match. Try another topic, or clear the filters.</p>'}
      </section>
      ${sel ? detail(sel, runs(sel.id), canEdit, orderCtx) : ''}
    </div></div>`;
  let typing;
  $('#q').oninput = e => { st.q = e.target.value; const pos = e.target.selectionStart; clearTimeout(typing);
    typing = setTimeout(() => render(el, _rest, params).then(() => { const i = $('#q'); i.focus(); i.setSelectionRange(pos, pos); }), 150); };
  $('#fg').onchange = e => { st.grade = e.target.value === 'All' ? 'All' : Number(e.target.value); st.sel = null; render(el, _rest, params); };
  $('#fs').onchange = e => { st.subject = e.target.value; st.topic = 'All'; st.sel = null; render(el, _rest, params); };
  $('#ft').onchange = e => { st.topic = e.target.value; st.sel = null; render(el, _rest, params); };
  const clr = $('#clr'); if (clr) clr.onclick = () => { Object.assign(st, { grade: 'All', subject: 'All', topic: 'All', q: '', sel: null }); render(el, _rest, params); };
  el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { st.sel = b.dataset.p; render(el, _rest, params); });
  const use = $('#useP'); if (use) use.onclick = async () => {
    const cards = hazcardsFor(db, sel.kit);
    if (cards.length && !(await hazcardModal(cards, `READ BEFORE ORDERING · ${cards.length} HAZCARD${cards.length > 1 ? 'S' : ''}`, 'I’ve read these — continue'))) return;
    go(orderCtx ? '#' + orderCtx + (orderCtx.includes('?') ? '&' : '?') + 'practical=' + encodeURIComponent(sel.id) : '#/order?practical=' + encodeURIComponent(sel.id));
  };
  const tnBtn = $('#tnBtn'), tnPop = $('#tnPop');
  if (tnBtn) { const show = on => { tnPop.hidden = !on; tnBtn.setAttribute('aria-expanded', String(on)); };
    tnBtn.onclick = e => { e.stopPropagation(); show(tnPop.hidden); };
    $('#tnClose').onclick = () => show(false);
    tnPop.onclick = e => e.stopPropagation();
    document.addEventListener('click', () => tnPop.isConnected && show(false));
    tnPop.addEventListener('keydown', e => { if (e.key === 'Escape') { show(false); tnBtn.focus(); } }); }
  el.querySelectorAll('[data-hz]').forEach(b => b.onclick = () => { const cards = hazcardsFor(db, sel.kit); const i = cards.findIndex(c => c.code === b.dataset.hz); hazcardModal(cards.slice(i).concat(cards.slice(0, i)), 'HAZCARD'); });
  $('#expP').onclick = () => download('practical-library-' + iso(new Date()) + '.csv', toCSV(db.library.map(p => ({ ...p, timesRun: runs(p.id).length, lastRun: lastRun(p)?.date || '' }))), 'text/csv');
  const ed = $('#editP'); if (ed) ed.onclick = () => edit(sel);
  const np = $('#newP'); if (np) np.onclick = () => edit({});
  const del = $('#delP'); if (del) del.onclick = async () => { if (await confirmBox('Remove this practical from the library?', 'Remove')) { await call('remove', { table: 'Library', key: sel.id }); st.sel = null; reload(); } };
  async function edit(p) {
    const v = await promptBox(p.id ? 'Edit practical' : 'New practical', [
      { name: 'title', label: 'Name', value: p.title }, { name: 'grade', label: 'Grade (e.g. 11, or 11-12 for both)', value: p.grade }, { name: 'subject', label: 'Subject', value: p.subject },
      { name: 'course', label: 'Course (IGCSE, A Level, IB…)', value: p.course }, { name: 'topic', label: 'Topic', value: p.topic },
      { name: 'sets', label: 'Usual number of sets', type: 'number', value: p.sets }, { name: 'prepMinutes', label: 'Prep time (minutes)', type: 'number', value: p.prepMinutes },
      { name: 'method', label: 'Method (numbered steps, or a link to the method sheet)', type: 'textarea', rows: 8, value: p.method },
      { name: 'prepNotes', label: 'Technician notes (solutions, set-up)', type: 'textarea', rows: 3, value: p.prepNotes }]);
    if (!v) return; await call('upsert', { table: 'Library', row: { ...p, ...v, grade: Number(v.grade) || String(v.grade || '').trim(), sets: Number(v.sets) || '', kit: p.kit || [] } }); toast('Saved'); reload();
  }
}

const isLink = v => /^https?:\/\/\S+$/.test(String(v || '').trim());

function detail(p, runs, canEdit, orderCtx) {
  const cards = hazcardsFor(db, p.kit); const today = iso(new Date());
  const badge = r => r.rating ? `<span class="pill warn">★ ${esc(r.rating)}</span>` : r.imported ? '<span class="pill">Imported</span>' : r.date >= today ? '<span class="pill st-accepted">Booked</span>' : `<span class="pill">${esc(r.status === 'done' ? 'Done' : r.status)}</span>`;
  const day = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const perGroup = p.kit.filter(k => !k.fixed), forClass = p.kit.filter(k => k.fixed);
  return `<article class="card lib-detail" aria-label="Practical">
    <header class="lib-dhead">
      <div class="grow"><div class="muted small">${[gradeLabel(p), p.subject, p.course, p.topic].filter(Boolean).map(esc).join(' · ')}</div>
        <h2 class="h1" style="margin-top:2px">${esc(p.title)}</h2></div>
      <div class="row gap wrap">${p.prepNotes ? `<span class="pop-wrap"><button class="btn" id="tnBtn" aria-expanded="false" aria-controls="tnPop">Technician notes</button>
          <div class="popover" id="tnPop" role="dialog" aria-label="Technician notes" hidden><div class="row between"><strong>Technician notes</strong><button class="icon-btn" id="tnClose" aria-label="Close">×</button></div>
          <div style="white-space:pre-wrap">${esc(p.prepNotes)}</div></div></span>` : ''}
        ${canEdit ? '<button class="btn" id="editP">Edit</button><button class="btn danger-outline" id="delP">Remove</button>' : ''}
        ${isLink(p.method) ? `<a class="btn" href="${esc(p.method)}" target="_blank" rel="noopener">Method sheet ↗</a>` : ''}
        <button class="btn pri" id="useP" title="Fills in the kit, method and sets (from the last time, or the usual number). You only pick the class, date and lab.">${orderCtx ? 'Use for this lesson' : 'Use for my order'}</button></div>
    </header>
    ${cards.length ? `<div class="chips"><span class="kicker danger" style="margin-right:4px">Hazcards</span>${cards.map(c => `<button class="chip hz" data-hz="${esc(c.code)}">${esc(c.code)}${c.title ? ' · ' + esc(c.title) : ''}</button>`).join('')}</div>` : ''}
    <div class="lib-cols">
      <section><h3 class="h3">Per group${p.sets ? ` <span class="muted small" style="font-weight:400">· usually ${esc(p.sets)} sets</span>` : ''}</h3>
        ${perGroup.length ? `<div class="kit-tags">${perGroup.map(k => `<span class="kit-tag"><b>${esc(k.perGroup)}×</b> ${esc(k.name)}${k.conc ? ` <span class="muted">(${esc(k.conc)})</span>` : ''}</span>`).join('')}</div>`
          : `<p class="muted small">${p.kit.length ? 'Nothing per group.' : 'No kit listed yet — see the method sheet. List the kit when you order, and it is saved here for next time.'}</p>`}
        ${forClass.length ? `<h3 class="h3" style="margin-top:12px">For the class</h3><div class="kit-tags">${forClass.map(k => `<span class="kit-tag"><b>${esc(k.perGroup)}×</b> ${esc(k.name)}</span>`).join('')}</div>` : ''}</section>
      <section>${p.method && !isLink(p.method) ? `<h3 class="h3">Method</h3><div class="lib-method">${esc(p.method)}</div>` : ''}
        <h3 class="h3"${p.method && !isLink(p.method) ? ' style="margin-top:14px"' : ''}>Done before</h3>${runs.length ? `<ul class="hist">${runs.slice(0, 8).map(r => `<li><b>${esc(day(r.date))}</b><span class="muted">${esc(r.class)} · ${esc(r.teacher)} · ${esc(roomName(db, r.room))} · ${esc(r.sets)} sets</span>${badge(r)}</li>`).join('')}</ul>` : '<p class="muted small">Not run yet.</p>'}</section>
    </div>
  </article>`;
}
