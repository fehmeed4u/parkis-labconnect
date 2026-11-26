import { db, session } from '../store.js';
import { esc, nice, iso, addDays, roomName, gradeOf, clashes, unavailable, totalStock, prepOf, stageOf, STAGES } from '../logic.js';
import { statusChip } from '../ui.js';
import { go } from '../app.js';
import { sheet, wireSheet } from './prep.js';
import { mineOf } from './home.js';

const st = { tab: 'open', q: '', mine: 'upcoming', limit: 25 };

export async function render(el, [selId]) {
  if (session.me.role === 'teacher') return mine(el);
  const today = iso(new Date());
  const tabs = {
    open: ['To do', r => r.date >= today && ['submitted', 'accepted', 'in_progress', 'ready'].includes(r.status)],
    new: ['New & late', r => r.status === 'submitted'],
    past: ['Done', r => r.date < today && ['done', 'ready', 'accepted', 'in_progress'].includes(r.status)],
    closed: ['Rejected / cancelled', r => ['rejected', 'cancelled'].includes(r.status)],
    drafts: ['Teachers’ drafts', r => r.status === 'draft']
  };
  const list = db.requests.filter(tabs[st.tab][1]).filter(r => !st.q || (r.title + r.teacher + r.class + r.room).toLowerCase().includes(st.q.toLowerCase()))
    .sort((a, b) => st.tab === 'past' ? (b.date + b.start).localeCompare(a.date + a.start) : (a.date + a.start).localeCompare(b.date + b.start));
  const sel = db.requests.find(r => r.id === selId) || list.find(r => r.status === 'submitted') || list[0];

  // group by day: today, tomorrow, the next school days, then later
  const tomorrow = iso(addDays(new Date(), 1)); const soon = iso(addDays(new Date(), 7));
  const groups = [];
  const label = d => st.tab === 'past' || st.tab === 'closed' || st.tab === 'drafts' ? nice(d).toUpperCase()
    : d === today ? 'TODAY · ' + nice(d).toUpperCase() : d === tomorrow ? 'DUE TOMORROW · ' + nice(d).toUpperCase() : d <= soon ? nice(d).toUpperCase() : 'LATER';
  list.slice(0, st.limit).forEach(r => { const l = label(r.date); let g = groups.find(x => x.label === l); if (!g) groups.push(g = { label: l, items: [] }); g.items.push(r); });

  const chip = r => r.query ? '<span class="pill st-queried">Queried</span>' : r.status === 'submitted' ? (r.late ? '<span class="pill urgent">Urgent</span>' : '<span class="pill new">New</span>') : statusChip(r.status);
  const flag = r => { const c = clashes(db, r)[0]; const un = unavailable(db, r);
    return un.length ? `${un.length} item${un.length > 1 ? 's' : ''} we don’t have` : c ? `Short ${Math.max(1, c.need + c.used - c.have)} × ${c.item.name}` : r.reply ? 'Teacher replied' : r.late && r.status === 'submitted' ? 'Late · sent ' + new Date(r.createdAt || r.updatedAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : r.hodApproved ? 'HOD approved' : ''; };
  const newN = db.requests.filter(r => r.status === 'submitted').length;
  const low = db.inventory.filter(i => Number(i.min) > 0 && totalStock(i) < Number(i.min)).length;
  const todayMin = db.requests.filter(r => r.date === today && ['accepted', 'in_progress', 'submitted'].includes(r.status))
    .reduce((s, r) => s + (Number(db.library.find(p => p.id === r.practicalId)?.prepMinutes) || 30), 0);

  el.innerHTML = `<div class="page">
    <header class="page-head">
      <div><div class="eyebrow">${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</div><h1 class="h1">Request queue</h1></div>
      <div class="chips"><span class="pill new">${newN} new</span><a class="pill urgent" href="#/inventory?flag=low" style="text-decoration:none">${low} low-stock items</a><span class="pill st-accepted">Prep booked today: ${Math.floor(todayMin / 60)} h ${todayMin % 60} min</span></div>
    </header>
    <div class="row gap wrap">
      <div class="chips">${Object.entries(tabs).map(([k, [l, f]]) => `<button class="chip${st.tab === k ? ' on' : ''}" data-tab="${k}">${esc(l)} ${db.requests.filter(f).length}</button>`).join('')}</div>
      <input type="search" id="rq" placeholder="Search teacher, class, practical…" value="${esc(st.q)}" aria-label="Search requests" style="flex:0 1 320px">
      <a class="btn" href="#/order" style="margin-left:auto">+ Order for a teacher</a>
    </div>
    <div class="cols">
      <section class="queue" aria-label="Queue">
        ${groups.map(g => `<div><h2>${esc(g.label)}</h2>${g.items.map(r => `<button class="qcard${sel && r.id === sel.id ? ' on' : ''}" data-open="${esc(r.id)}" aria-pressed="${!!sel && r.id === sel.id}">
          <span class="row between gap"><span class="t">${esc(r.title)}</span>${chip(r)}</span>
          <span class="m">${esc(r.class)} · ${esc(st.tab === 'past' || label(r.date) === 'LATER' ? nice(r.date) + ' · ' : '')}${esc(r.start)}–${esc(r.end)} · ${esc(roomName(db, r.room))} · ${esc(r.sets)} groups · ${esc(r.teacher)}</span>
          ${flag(r) ? `<span class="f">${esc(flag(r))}</span>` : ''}</button>`).join('')}</div>`).join('') || '<p class="muted">Nothing here.</p>'}
        ${list.length > st.limit ? `<div class="row between wrap"><span class="muted small">Showing ${st.limit} of ${list.length}.</span><button class="btn small" id="qmore">Show more</button></div>` : ''}
      </section>
      ${sel ? `<section class="card sheet" aria-label="Prep sheet" id="sheet">${sheet(sel)}</section>` : ''}
    </div></div>`;
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; st.limit = 25; go('#/requests'); render(el, []); });
  const q = el.querySelector('#rq'); q.oninput = () => { st.q = q.value; const p = q.selectionStart; render(el, [selId]).then(() => { const i = el.querySelector('#rq'); i.focus(); i.setSelectionRange(p, p); }); };
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { history.replaceState(null, '', '#/requests/' + b.dataset.open); render(el, [b.dataset.open]); if (innerWidth < 900) document.getElementById('sheet')?.scrollIntoView({ behavior: 'smooth' }); });
  const qm = el.querySelector('#qmore'); if (qm) qm.onclick = () => { st.limit += 25; render(el, [selId]); };
  if (sel) wireSheet(el.querySelector('#sheet'), sel, () => render(el, [sel.id]));
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
      ${['draft', 'submitted', 'accepted', 'in_progress', 'ready'].includes(r.status) && r.date >= today ? `<div class="row gap small"><a class="linkbtn" href="#/order?id=${esc(r.id)}">${r.status === 'draft' ? 'Continue draft' : 'Change'}</a></div>` : ''}
    </article>`; }).join('') || '<p class="muted">Nothing here.</p>'}</section></div>`;
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { st.mine = b.dataset.t; mine(el); });
}
