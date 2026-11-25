import { db, session } from '../store.js';
import { esc, nice, iso, roomName, gradeOf, clashes } from '../logic.js';
import { modal, statusChip } from '../ui.js';
import { overview, wire } from './week.js';

const st = { tab: 'new', q: '' };

export async function render(el) {
  const today = iso(new Date());
  const tabs = {
    new: ['New & late', r => r.status === 'submitted'],
    upcoming: ['Upcoming', r => r.date >= today && ['accepted', 'in_progress', 'ready'].includes(r.status)],
    past: ['Done', r => r.date < today && ['done', 'ready', 'accepted', 'in_progress'].includes(r.status)],
    closed: ['Rejected / cancelled', r => ['rejected', 'cancelled'].includes(r.status)],
    drafts: ['Teachers’ drafts', r => r.status === 'draft']
  };
  const list = db.requests.filter(tabs[st.tab][1]).filter(r => !st.q || (r.title + r.teacher + r.class + r.room).toLowerCase().includes(st.q.toLowerCase()))
    .sort((a, b) => st.tab === 'past' ? (b.date + b.start).localeCompare(a.date + a.start) : (a.date + a.start).localeCompare(b.date + b.start));
  el.innerHTML = `<div class="page">
    <div class="row between wrap"><h1 class="h1">Requests</h1>${session.me.role !== 'teacher' ? '<a class="btn" href="#/order">+ Order for a teacher</a>' : ''}</div>
    <div class="row gap wrap"><div class="chips">${Object.entries(tabs).map(([k, [l, f]]) => `<button class="chip${st.tab === k ? ' on' : ''}" data-tab="${k}">${esc(l)} <b>${db.requests.filter(f).length}</b></button>`).join('')}</div>
    <input type="search" id="rq" placeholder="Search teacher, class, practical…" value="${esc(st.q)}"></div>
    <section class="card flush scroll"><table class="tbl"><thead><tr><th>When</th><th>Practical</th><th>Class</th><th>Teacher</th><th>Room</th><th>Sets</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map(r => `<tr><td><strong>${esc(nice(r.date))}</strong><br><span class="muted small">${esc(r.start)}–${esc(r.end)}</span></td>
      <td>${esc(r.title)}${r.late ? ' <span class="pill st-rejected small">Late</span>' : ''}${clashes(db, r).length ? ' <span class="pill danger small">Clash</span>' : ''}</td>
      <td>G${esc(gradeOf(r.class))} · ${esc(r.class)}<br><span class="muted small">${esc(r.subject)}</span></td><td>${esc(r.teacher)}</td><td>${esc(roomName(db, r.room))}</td><td>${esc(r.sets)}</td><td>${statusChip(r.status)}</td>
      <td><button class="btn small" data-open="${esc(r.id)}">Open</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nothing here.</td></tr>'}
    </tbody></table></section></div>`;
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; render(el); });
  const q = el.querySelector('#rq'); q.oninput = () => { st.q = q.value; const p = q.selectionStart; render(el).then(() => { const i = el.querySelector('#rq'); i.focus(); i.setSelectionRange(p, p); }); };
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { modal(overview(b.dataset.open)); wire(document.getElementById('overlay'), el, b.dataset.open); });
}
