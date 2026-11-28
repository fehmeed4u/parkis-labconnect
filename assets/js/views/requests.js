import { db, session } from '../store.js';
import { esc, nice, iso, addDays, roomName, gradeOf, clashes, unavailable, totalStock, prepOf, stageOf, STAGES, teacherCanEdit, canPostpone } from '../logic.js';
import { statusChip, confirmBox, toast } from '../ui.js';
import { go, reload } from '../app.js';
import { call } from '../store.js';
import { sheet, wireSheet } from './prep.js';
import { mineOf } from './home.js';

const st = { tab: 'open', q: '', mine: 'upcoming', limit: 25 };
/** Wide enough for the queue and the prep sheet side by side (sidebar + 340px queue + 560px sheet). */
const SIDE_BY_SIDE = '(min-width: 1220px)';

export async function render(el, [selId]) {
  if (session.me.role === 'teacher') return mine(el);
  const today = iso(new Date());
  const tabs = {
    open: ['To do', r => r.date >= today && (['submitted', 'accepted', 'in_progress', 'ready'].includes(r.status) || (r.status === 'cancelled' && !!r.flag))],
    new: ['Late — to approve', r => r.status === 'submitted'],
    past: ['Done', r => r.date < today && ['done', 'ready', 'accepted', 'in_progress'].includes(r.status)],
    closed: ['Rejected / cancelled', r => ['rejected', 'cancelled'].includes(r.status)],
    drafts: ['Teachers’ drafts', r => r.status === 'draft']
  };
  const list = db.requests.filter(tabs[st.tab][1]).filter(r => !st.q || (r.title + r.teacher + r.class + r.room).toLowerCase().includes(st.q.toLowerCase()))
    .sort((a, b) => st.tab === 'past' ? (b.date + b.start).localeCompare(a.date + a.start) : (a.date + a.start).localeCompare(b.date + b.start));
  // On narrower screens (iPad) the prep sheet would land below the whole queue, so there each request opens its own page.
  const sideBySide = matchMedia(SIDE_BY_SIDE).matches;
  const sel = sideBySide ? db.requests.find(r => r.id === selId) || list.find(r => r.status === 'submitted') || list[0] : null;
  const current = selId;

  // group by day: today, tomorrow, the next school days, then later
  const tomorrow = iso(addDays(new Date(), 1)); const soon = iso(addDays(new Date(), 7));
  const groups = [];
  const label = d => st.tab === 'past' || st.tab === 'closed' || st.tab === 'drafts' ? nice(d).toUpperCase()
    : d === today ? 'TODAY · ' + nice(d).toUpperCase() : d === tomorrow ? 'DUE TOMORROW · ' + nice(d).toUpperCase() : d <= soon ? nice(d).toUpperCase() : 'LATER';
  list.slice(0, st.limit).forEach(r => { const l = label(r.date); let g = groups.find(x => x.label === l); if (!g) groups.push(g = { label: l, items: [] }); g.items.push(r); });

  const chip = r => r.query ? '<span class="pill st-queried">Queried</span>' : statusChip(r.status, r);
  const flag = r => { if (r.flag) return r.flag; const c = clashes(db, r)[0]; const un = unavailable(db, r);
    return un.length ? `${un.length} item${un.length > 1 ? 's' : ''} we don’t have` : c ? `Short ${Math.max(1, c.need + c.used - c.have)} × ${c.item.name}` : r.reply ? 'Teacher replied' : r.late && r.status === 'submitted' ? 'Late · sent ' + new Date(r.createdAt || r.updatedAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : r.hodApproved ? 'HOD approved' : ''; };
  const newN = db.requests.filter(r => r.status === 'submitted').length;
  const low = db.inventory.filter(i => Number(i.min) > 0 && totalStock(i) < Number(i.min)).length;
  const todayMin = db.requests.filter(r => r.date === today && ['accepted', 'in_progress', 'submitted'].includes(r.status))
    .reduce((s, r) => s + (Number(db.library.find(p => p.id === r.practicalId)?.prepMinutes) || 30), 0);

  el.innerHTML = `<div class="page">
    <header class="page-head">
      <div><div class="eyebrow">${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</div><h1 class="h1">Request queue</h1></div>
      <div class="chips"><a class="pill st-submitted" href="#/requests" data-tab="new" style="text-decoration:none">${newN} late to approve</a><a class="pill urgent" href="#/inventory?flag=low" style="text-decoration:none">${low} low-stock items</a><span class="pill st-accepted">Prep booked today: ${Math.floor(todayMin / 60)} h ${todayMin % 60} min</span></div>
    </header>
    <div class="row gap wrap">
      <div class="chips">${Object.entries(tabs).map(([k, [l, f]]) => `<button class="chip${st.tab === k ? ' on' : ''}" data-tab="${k}">${esc(l)} ${db.requests.filter(f).length}</button>`).join('')}</div>
      <input type="search" id="rq" placeholder="Search teacher, class, practical…" value="${esc(st.q)}" aria-label="Search requests" style="flex:0 1 320px">
      <a class="btn" href="#/order" style="margin-left:auto">+ Order for a teacher</a>
    </div>
    <div class="cols">
      <section class="queue" aria-label="Queue">
        ${groups.map(g => `<div><h2>${esc(g.label)}</h2>${g.items.map(r => (sideBySide ? `<button class="qcard${sel && r.id === sel.id ? ' on' : ''}" data-open="${esc(r.id)}" aria-pressed="${!!sel && r.id === sel.id}">` : `<a class="qcard${r.id === current ? ' on' : ''}" href="#/prep/${esc(r.id)}">`) + `
          <span class="row between gap"><span class="t">${esc(r.title)}</span>${chip(r)}</span>
          <span class="m">${esc(r.class)} · ${esc(st.tab === 'past' || label(r.date) === 'LATER' ? nice(r.date) + ' · ' : '')}${esc(r.start)}–${esc(r.end)} · ${esc(roomName(db, r.room))} · ${esc(r.sets)} groups · ${esc(r.teacher)}</span>
          ${flag(r) ? `<span class="f">${esc(flag(r))}</span>` : ''}${sideBySide ? '</button>' : '</a>'}`).join('')}</div>`).join('') || '<p class="muted">Nothing here.</p>'}
        ${list.length > st.limit ? `<div class="row between wrap"><span class="muted small">Showing ${st.limit} of ${list.length}.</span><button class="btn small" id="qmore">Show more</button></div>` : ''}
      </section>
      ${sel ? `<section class="card sheet" aria-label="Prep sheet" id="sheet">${sheet(sel)}</section>` : ''}
    </div></div>`;
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; st.limit = 25; go('#/requests'); render(el, []); });
  const q = el.querySelector('#rq'); q.oninput = () => { st.q = q.value; const p = q.selectionStart; render(el, [selId]).then(() => { const i = el.querySelector('#rq'); i.focus(); i.setSelectionRange(p, p); }); };
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { history.replaceState(null, '', '#/requests/' + b.dataset.open); render(el, [b.dataset.open]); });
  const qm = el.querySelector('#qmore'); if (qm) qm.onclick = () => { st.limit += 25; render(el, [selId]); };
  if (sel) wireSheet(el.querySelector('#sheet'), sel, () => render(el, [sel.id]));
}

/** Change / cancel while nobody has started preparing it (red); postpone any time before the lesson. */
export function teacherActions(r) {
  const edit = teacherCanEdit(r), move = canPostpone(r);
  if (!edit && !move) return '';
  return `<div class="row gap small wrap">${edit ? `<a class="linkbtn" href="#/order?id=${esc(r.id)}">${r.status === 'draft' ? 'Continue draft' : 'Change'}</a>` : ''}
    ${move ? `<a class="linkbtn" href="#/order?postpone=${esc(r.id)}">Postpone</a>` : ''}
    ${edit ? `<button class="linkbtn danger" data-cancel="${esc(r.id)}">Cancel</button>` : ''}
    ${!edit ? '<span class="muted">The technicians have started preparing it — talk to them to change or cancel it.</span>' : ''}</div>`;
}

export async function cancelRequest(id) {
  if (!(await confirmBox('Cancel this practical? The technicians will be told.', 'Cancel it'))) return;
  try { await call('updateRequest', { id, patch: { status: 'cancelled' } }); toast('Cancelled — the technicians have been told'); await reload(); } catch (e) { toast(e.message === 'locked' ? 'The technicians have already started preparing it — talk to them.' : e.message, 'bad'); }
}

/** Teacher view: every request I've made. */
function mine(el) {
  const today = iso(new Date()); const all = mineOf(session.me);
  const tabs = { upcoming: ['Upcoming', r => r.date >= today && !['draft', 'cancelled', 'rejected'].includes(r.status)], drafts: ['Drafts', r => r.status === 'draft'],
    past: ['Past', r => r.date < today && !['draft', 'cancelled', 'rejected'].includes(r.status)], closed: ['Rejected / cancelled', r => ['cancelled', 'rejected'].includes(r.status)] };
  const list = all.filter(tabs[st.mine][1]).sort((a, b) => st.mine === 'past' ? (b.date + b.start).localeCompare(a.date + a.start) : (a.date + a.start).localeCompare(b.date + b.start));
  el.innerHTML = `<div class="page" style="max-width:1000px">
    <header class="page-head"><div><h1 class="h1">My requests</h1><p class="lede">Everything you’ve ordered, with where it is now.</p></div><a class="btn pri" href="#/order">Order a practical</a></header>
    <div class="chips">${Object.entries(tabs).map(([k, [l, f]]) => `<button class="chip${st.mine === k ? ' on' : ''}" data-t="${k}">${l} ${all.filter(f).length}</button>`).join('')}</div>
    <section class="card stack">${list.map(r => { const s = stageOf(r, today); return `<article class="req">
      <div class="row between wrap" style="align-items:flex-start"><div><div class="req-title">${esc(r.title)}</div><div class="req-meta">Grade ${esc(gradeOf(r.class))} · ${esc(r.class)} · ${esc(nice(r.date))} · ${esc(r.start)}–${esc(r.end)} · ${esc(roomName(db, r.room))} · ${esc(r.sets)} groups</div></div>${statusChip(r.status, r)}</div>
      <div class="steps${r.query ? ' q' : ''}${['rejected', 'cancelled'].includes(r.status) ? ' x' : ''}" role="img" aria-label="Stage ${s} of 7: ${STAGES[s - 1]}">${STAGES.map((_, i) => `<i class="${i < s ? 'on' : ''}"></i>`).join('')}</div>
      ${r.query ? `<div class="note query"><strong>Technician asks:</strong> ${esc(r.query)} — reply from <a href="#/home">Home</a>.</div>` : ''}
      ${r.techNotes && r.status === 'rejected' ? `<div class="note bad">${esc(r.techNotes)}</div>` : ''}
      ${r.rating ? `<div class="small muted">Your rating: ★ ${esc(r.rating)}${r.feedback ? ' · ' + esc(r.feedback) : ''}</div>` : ''}
      ${r.date >= today ? teacherActions(r) : ''}
    </article>`; }).join('') || '<p class="muted">Nothing here.</p>'}</section></div>`;
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { st.mine = b.dataset.t; mine(el); });
  el.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => cancelRequest(b.dataset.cancel));
}
