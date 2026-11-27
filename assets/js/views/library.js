import { db, session, call } from '../store.js';
import { esc, nice, iso, hazcardsFor, roomName, toCSV, gradesOf, gradeLabel } from '../logic.js';
import { $, hazcardModal, promptBox, toast, confirmBox, download } from '../ui.js';
import { go, reload } from '../app.js';

const st = { grade: 'All', topic: 'All', q: '', sel: null };

export async function render(el, _rest, params = new URLSearchParams()) {
  const orderCtx = params.get('order'); // set when a teacher is choosing a practical for a lesson (#/order step 2)
  if (orderCtx && st._ctx !== orderCtx) { st._ctx = orderCtx; const g = Number(params.get('grade')); st.grade = g && db.library.some(p => gradesOf(p).includes(g)) ? g : 'All'; st.topic = 'All'; st.q = ''; st.sel = null; }
  const ctxLesson = (() => { if (!orderCtx) return null; const p = new URLSearchParams(orderCtx.split('?')[1] || ''); const t = p.get('teacher') || session.me.name;
    const l = db.timetable.find(x => x.teacher === t && x.start === p.get('start') && x.day === ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(p.get('date') + 'T12:00').getDay()]);
    return l ? { ...l, date: p.get('date') } : null; })();
  const runs = id => db.requests.filter(r => r.practicalId === id && !['draft', 'cancelled', 'rejected'].includes(r.status)).sort((a, b) => b.date.localeCompare(a.date));
  const grades = ['All', ...[...new Set(db.library.flatMap(gradesOf))].sort((a, b) => a - b)];
  const byGrade = db.library.filter(p => st.grade === 'All' || gradesOf(p).includes(st.grade));
  const topics = ['All', ...new Set(byGrade.map(p => p.topic).filter(Boolean))];
  const list = byGrade.filter(p => (st.topic === 'All' || p.topic === st.topic) && (!st.q || (p.title + ' ' + p.topic + ' ' + p.subject).toLowerCase().includes(st.q.toLowerCase())));
  const sel = db.library.find(p => p.id === st.sel) || list[0];
  const canEdit = session.me.role !== 'teacher';
  const chip = (on, label, attr) => `<button class="chip${on ? ' on' : ''}" ${attr}>${esc(label)}</button>`;
  const lastRun = p => runs(p.id)[0];
  const monthYear = d => new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  el.innerHTML = `<div class="page">
    <header class="page-head"><div><h1 class="h1">Practical library</h1><p class="lede">Every practical we’ve run, by grade and topic. Pick one to start your order.</p></div>
    <div class="row gap wrap">${session.me.role === 'admin' ? '<a class="btn" href="#/admin/data">Import old sheets</a>' : ''}${canEdit ? '<button class="btn" id="newP">+ Add practical</button>' : ''}<button class="btn" id="expP">Export</button></div></header>
    ${orderCtx ? `<div class="note ok row between wrap"><span>Choosing a practical for ${ctxLesson ? `<strong>${esc(ctxLesson.class)} · ${esc(nice(ctxLesson.date))} ${esc(ctxLesson.start)}</strong>` : 'your lesson'}. Pick one, then press <strong>Use for my order</strong> — you can edit or adapt it next.</span><a class="btn small" href="#${esc(orderCtx)}">‹ Back</a></div>` : ''}
    <div class="row gap wrap"><input id="q" type="search" placeholder="Search: density, titration, osmosis…" value="${esc(st.q)}" aria-label="Search the library" style="flex:0 1 380px">
      <div class="chips">${grades.map(g => chip(st.grade === g, g === 'All' ? 'All grades' : 'G' + g, `data-g="${g}"`)).join('')}</div></div>
    <div class="chips"><span class="small" style="color:var(--ink-2);margin-right:2px">Topic</span>${topics.map(t => chip(st.topic === t, t === 'All' ? 'All topics' : t, `data-t="${esc(t)}"`)).join('')}</div>
    <div class="cols">
      <section class="grid-cards">${list.map(p => { const r = runs(p.id); return `<button class="pcard${sel && p.id === sel.id ? ' on' : ''}" data-p="${esc(p.id)}" aria-pressed="${!!sel && p.id === sel.id}">
        <span class="meta">${[gradeLabel(p), p.subject].filter(Boolean).map(esc).join(' · ')}</span><strong>${esc(p.title)}</strong><span class="topic">${esc(p.topic || '')}</span>
        <span class="foot"><span>Done ${r.length}×</span><span>${r[0] ? 'Last: ' + esc(monthYear(r[0].date)) : 'Not run yet'}</span></span></button>`; }).join('') || '<p class="muted">No practicals for this grade and topic yet.</p>'}</section>
      ${sel ? detail(sel, runs(sel.id), canEdit, orderCtx) : ''}
    </div>
    <p class="muted xs">The library grows by itself: every practical ordered in the app is added here with its kit.</p></div>`;
  $('#q').oninput = e => { st.q = e.target.value; const pos = e.target.selectionStart; render(el, _rest, params).then(() => { const i = $('#q'); i.focus(); i.setSelectionRange(pos, pos); }); };
  el.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { st.grade = b.dataset.g === 'All' ? 'All' : Number(b.dataset.g); st.topic = 'All'; render(el, _rest, params); });
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { st.topic = b.dataset.t; render(el, _rest, params); });
  el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { st.sel = b.dataset.p; render(el, _rest, params); });
  const use = $('#useP'); if (use) use.onclick = async () => {
    const cards = hazcardsFor(db, sel.kit);
    if (cards.length && !(await hazcardModal(cards, `READ BEFORE ORDERING · ${cards.length} HAZCARD${cards.length > 1 ? 'S' : ''}`, 'I’ve read these — continue'))) return;
    go(orderCtx ? '#' + orderCtx + (orderCtx.includes('?') ? '&' : '?') + 'practical=' + encodeURIComponent(sel.id) : '#/order?practical=' + encodeURIComponent(sel.id));
  };
  el.querySelectorAll('[data-hz]').forEach(b => b.onclick = () => { const cards = hazcardsFor(db, sel.kit); const i = cards.findIndex(c => c.code === b.dataset.hz); hazcardModal(cards.slice(i).concat(cards.slice(0, i)), 'HAZCARD'); });
  $('#expP').onclick = () => download('practical-library-' + iso(new Date()) + '.csv', toCSV(db.library.map(p => ({ ...p, timesRun: runs(p.id).length, lastRun: lastRun(p)?.date || '' }))), 'text/csv');
  const ed = $('#editP'); if (ed) ed.onclick = () => edit(sel);
  const np = $('#newP'); if (np) np.onclick = () => edit({});
  const del = $('#delP'); if (del) del.onclick = async () => { if (await confirmBox('Remove this practical from the library?', 'Remove')) { await call('remove', { table: 'Library', key: sel.id }); st.sel = null; reload(); } };
  async function edit(p) {
    const v = await promptBox(p.id ? 'Edit practical' : 'New practical', [
      { name: 'title', label: 'Name', value: p.title }, { name: 'grade', label: 'Grade (e.g. 11, or 11-12 for both)', value: p.grade }, { name: 'subject', label: 'Subject', value: p.subject },
      { name: 'course', label: 'Course (IGCSE, A Level, IB…)', value: p.course }, { name: 'topic', label: 'Topic', value: p.topic },
      { name: 'prepMinutes', label: 'Prep time (minutes)', type: 'number', value: p.prepMinutes }, { name: 'method', label: 'Method sheet link', value: p.method }]);
    if (!v) return; await call('upsert', { table: 'Library', row: { ...p, ...v, grade: Number(v.grade) || String(v.grade || '').trim(), kit: p.kit || [] } }); toast('Saved'); reload();
  }
}

function detail(p, runs, canEdit, orderCtx) {
  const cards = hazcardsFor(db, p.kit); const today = iso(new Date());
  const badge = r => r.rating ? `<span class="pill warn">★ ${esc(r.rating)}</span>` : r.imported ? '<span class="pill">Imported</span>' : r.date >= today ? '<span class="pill st-accepted">Booked</span>' : `<span class="pill">${esc(r.status === 'done' ? 'Done' : r.status)}</span>`;
  const day = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return `<aside class="card side-col sticky" style="gap:16px">
    <div><div class="muted xs" style="font-weight:500">${[gradeLabel(p), p.subject, p.course].filter(Boolean).map(esc).join(' · ')}</div><h2 class="h2" style="font-family:var(--display);font-size:24px;margin-top:4px">${esc(p.title)}</h2>${p.topic ? `<div class="muted">Topic: ${esc(p.topic)}</div>` : ''}</div>
    <div><h3 class="h3">Per group</h3><ul class="rules" style="line-height:1.6">${p.kit.map(k => `<li>${esc(k.perGroup)} × ${esc(k.name)}</li>`).join('') || '<li class="muted">No kit listed yet</li>'}</ul></div>
    ${cards.length ? `<div class="chips"><span class="kicker danger">Hazcards</span>${cards.map(c => `<button class="chip hz" data-hz="${esc(c.code)}">${esc(c.code)}${c.title ? ' · ' + esc(c.title) : ''}</button>`).join('')}</div>` : ''}
    <div><h3 class="h3">Done before</h3>${runs.length ? `<ul class="hist">${runs.slice(0, 8).map(r => `<li><b>${esc(day(r.date))}</b><span class="muted">${esc(r.class)} · ${esc(r.teacher)} · ${esc(roomName(db, r.room))} · ${esc(r.sets)} sets</span>${badge(r)}</li>`).join('')}</ul>` : '<p class="muted small">Not run yet.</p>'}</div>
    ${p.method || canEdit ? `<div class="links">${p.method ? `<a href="${esc(p.method)}" target="_blank" rel="noopener">Method sheet</a>` : ''}${p.method && canEdit ? '<span class="sep"></span>' : ''}${canEdit ? '<button class="linkbtn" id="editP">Edit</button><span class="sep"></span><button class="linkbtn danger" id="delP">Remove</button>' : ''}</div>` : ''}
    <div><button class="btn pri big block" id="useP">${orderCtx ? 'Use for this lesson' : 'Use for my order'}</button>
    <p class="muted xs" style="margin-top:8px">Fills in the kit and sets from the last time. You only pick the class, date and lab.</p></div>
  </aside>`;
}
