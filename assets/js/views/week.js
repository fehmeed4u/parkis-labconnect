import { db, session, call } from '../store.js';
import { esc, iso, addDays, monday, min, fmtMin, nice, DAYS, hazcardsFor, roomName, labRooms, clashes, gradeOf } from '../logic.js';
import { $, modal, closeModal, toast, promptBox } from '../ui.js';
import { go, reload } from '../app.js';

const st = { offset: 0, layout: pref('layout', 'week'), across: pref('across', 'days'), colDay: -1, labDay: 0 };
function pref(k, d) { try { return localStorage.getItem('sp_week_' + k) || d; } catch (e) { return d; } }
function setPref(k, v) { st[k] = v; try { localStorage.setItem('sp_week_' + k, v); } catch (e) {} }
const SHOW = ['submitted', 'accepted', 'in_progress', 'ready', 'done'];
const NAMES = ['not started', 'in progress', 'prepared'];

export async function render(el) {
  const mon = addDays(monday(new Date()), st.offset * 7);
  const dates = DAYS.map((_, i) => iso(addDays(mon, i)));
  const jobs = db.requests.filter(r => dates.includes(r.date) && SHOW.includes(r.status)).map(r => ({ ...r, day: dates.indexOf(r.date), p: r.status === 'done' || r.status === 'ready' ? 2 : r.status === 'in_progress' ? 1 : Number(r.prep) || 0 }));
  const n = k => jobs.filter(j => j.p === k).length;
  const dayStart = min(db.settings.dayStart || '08:30'), dayEnd = min(db.settings.dayEnd || '16:00');
  const slots = []; for (let t = dayStart; t < dayEnd; t += 30) slots.push(t);
  const slotOf = s => Math.max(0, Math.round((min(s) - dayStart) / 30));
  const span = j => Math.max(1, slotOf(j.end) - slotOf(j.start));
  const label = j => `${j.title}, G${gradeOf(j.class)} ${j.subject}, ${nice(j.date)} ${j.start}, ${j.room}, ${NAMES[j.p]}${j.status === 'submitted' ? ', new request' : ''}`;
  const card = (j, pos, cls = 'job') => `<button class="${cls} p${j.p}${j.status === 'submitted' ? ' new' : ''}${j.late ? ' late' : ''}" style="${pos}" data-job="${esc(j.id)}" aria-label="${esc(label(j))}">
      <span class="jt">${esc(j.title)}</span><span class="js">G${esc(gradeOf(j.class))} · ${esc(j.subject)}</span>
      <span class="jr"><span>${esc(j.room)}</span>${j.late || j.status === 'submitted' || clashes(db, j).length ? '<i aria-hidden="true">!</i>' : ''}</span></button>`;

  // lanes so overlapping jobs sit side by side
  const lanes = [1, 1, 1, 1, 1], laneOf = {};
  for (let d = 0; d < 5; d++) { const ends = []; jobs.filter(j => j.day === d).sort((a, b) => min(a.start) - min(b.start)).forEach(j => {
    let l = ends.findIndex(e => e <= min(j.start)); if (l < 0) { l = ends.length; ends.push(0); } ends[l] = min(j.end); laneOf[j.id] = l; }); lanes[d] = Math.max(1, ends.length); }
  const off = [0]; for (let d = 0; d < 5; d++) off.push(off[d] + lanes[d]);
  const tot = off[5];
  const head = d => `${DAYS[d]} ${addDays(mon, d).getDate()}`;

  let body = '';
  const L = st.layout;
  const grid = () => {
    let g = '';
    if (st.across === 'days') {
      g += `<div class="wgrid" style="grid-template-columns:56px repeat(${tot},minmax(92px,1fr));grid-template-rows:38px repeat(${slots.length},44px);min-width:${56 + tot * 92}px">`;
      g += `<div class="gh" style="grid-column:1;grid-row:1"></div>`;
      DAYS.forEach((_, d) => g += `<div class="gh" style="grid-column:${2 + off[d]} / span ${lanes[d]};grid-row:1">${head(d)}</div>`);
      slots.forEach((t, r) => { g += `<div class="gt${t % 60 ? '' : ' hr'}" style="grid-column:1;grid-row:${2 + r}">${t % 60 && r ? '' : fmtMin(t)}</div>`;
        DAYS.forEach((_, d) => g += `<div class="gc${t % 60 ? '' : ' hr'}" style="grid-column:${2 + off[d]} / span ${lanes[d]};grid-row:${2 + r}"></div>`); });
      jobs.forEach(j => g += card(j, `grid-column:${2 + off[j.day] + laneOf[j.id]};grid-row:${2 + slotOf(j.start)} / span ${span(j)}`));
    } else {
      g += `<div class="wgrid" style="grid-template-columns:70px repeat(${slots.length},minmax(64px,1fr));grid-template-rows:36px repeat(${tot},78px);min-width:${70 + slots.length * 64}px">`;
      g += `<div class="gh" style="grid-column:1;grid-row:1"></div>`;
      slots.forEach((t, c) => g += `<div class="gh gt" style="grid-column:${2 + c};grid-row:1">${t % 60 && c ? '' : fmtMin(t)}</div>`);
      DAYS.forEach((_, d) => { g += `<div class="gh" style="grid-column:1;grid-row:${2 + off[d]} / span ${lanes[d]}">${head(d)}</div>`;
        slots.forEach((t, c) => g += `<div class="gc${t % 60 ? '' : ' vr'}" style="grid-column:${2 + c};grid-row:${2 + off[d]} / span ${lanes[d]}"></div>`); });
      jobs.forEach(j => g += card(j, `grid-row:${2 + off[j.day] + laneOf[j.id]};grid-column:${2 + slotOf(j.start)} / span ${span(j)}`));
    }
    return `<section class="card flush scroll grow" aria-label="Week grid">${g}</div></section>`;
  };
  if (L === 'week') body = grid();
  if (L === 'sidebar') body = `<div class="cols">${grid()}<aside class="card side" id="detail">${st.sel ? '' : '<p class="muted">Click a practical.</p>'}</aside></div>`;
  if (L === 'today') {
    const td = dates.includes(iso(new Date())) ? iso(new Date()) : dates[0];
    const list = jobs.filter(j => j.date === td).sort((a, b) => min(a.start) - min(b.start));
    body = `<div class="cols"><aside class="card side stack"><h2 class="h2">${esc(nice(td))}</h2>${list.map(j => `<button class="todayrow p${j.p}" data-job="${esc(j.id)}" aria-label="${esc(label(j))}"><b>${esc(j.start)}</b><span><strong>${esc(j.title)}</strong><span class="small">G${esc(gradeOf(j.class))} · ${esc(j.subject)} · ${esc(j.room)}</span></span></button>`).join('') || '<p class="muted">Nothing today.</p>'}</aside>${grid()}</div>`;
  }
  if (L === 'columns') {
    body = `<div class="chips">${[-1, 0, 1, 2, 3, 4].map(d => `<button class="chip${st.colDay === d ? ' on' : ''}" data-cd="${d}">${d < 0 ? 'All week' : head(d)}</button>`).join('')}</div>
    <div class="kcols">${[0, 1, 2].map(k => { const l = jobs.filter(j => j.p === k && (st.colDay < 0 || j.day === st.colDay)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
      return `<section class="kcol k${k}" aria-label="${NAMES[k]}"><div class="kh"><i class="dot d${k}" aria-hidden="true"></i><strong>${l.length}</strong></div>${l.map(j => `<button class="kcard${j.status === 'submitted' ? ' new' : ''}" data-job="${esc(j.id)}" aria-label="${esc(label(j))}"><strong>${esc(j.title)}</strong><span class="small muted">G${esc(gradeOf(j.class))} · ${esc(j.subject)}</span><span class="row between small"><b>${esc(DAYS[j.day])} ${esc(j.start)}</b><b>${esc(j.room)}</b></span></button>`).join('')}</section>`; }).join('')}</div>`;
  }
  if (L === 'labs') {
    const rooms = labRooms(db).map(l => l.room); const extra = [...new Set(jobs.filter(j => j.day === st.labDay && !rooms.includes(j.room)).map(j => j.room))]; const all = rooms.concat(extra);
    let g = `<div class="wgrid" style="grid-template-columns:78px repeat(${slots.length},minmax(66px,1fr));grid-template-rows:36px repeat(${all.length},62px);min-width:${78 + slots.length * 66}px"><div class="gh" style="grid-column:1;grid-row:1"></div>`;
    slots.forEach((t, c) => g += `<div class="gh gt" style="grid-column:${2 + c};grid-row:1">${t % 60 && c ? '' : fmtMin(t)}</div>`);
    all.forEach((r, i) => { g += `<div class="gh" style="grid-column:1;grid-row:${2 + i}">${esc(r)}</div>`; slots.forEach((t, c) => g += `<div class="gc${t % 60 ? '' : ' vr'}" style="grid-column:${2 + c};grid-row:${2 + i}"></div>`); });
    jobs.filter(j => j.day === st.labDay).forEach(j => g += card(j, `grid-row:${2 + all.indexOf(j.room)};grid-column:${2 + slotOf(j.start)} / span ${span(j)}`));
    body = `<div class="chips">${DAYS.map((_, d) => `<button class="chip${st.labDay === d ? ' on' : ''}" data-ld="${d}">${head(d)}</button>`).join('')}</div><section class="card flush scroll">${g}</div></section>`;
  }

  el.innerHTML = `<div class="page wide">
    <div class="row between wrap">
      <div class="row gap"><button class="icon-btn b" data-w="-1" aria-label="Previous week">‹</button><h1 class="h1 tight">${esc(mon.getDate() + ' ' + mon.toLocaleDateString('en-GB', { month: 'short' }))}–${esc(addDays(mon, 4).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</h1><button class="icon-btn b" data-w="1" aria-label="Next week">›</button>
        ${st.offset ? '<button class="linkbtn" data-w="0">This week</button>' : ''}
        <span class="counts"><span aria-label="${n(0)} not started"><i class="dot d0"></i>${n(0)}</span><span aria-label="${n(1)} in progress"><i class="dot d1"></i>${n(1)}</span><span aria-label="${n(2)} prepared"><i class="dot d2"></i>${n(2)}</span></span></div>
      <div class="row gap wrap"><div class="seg" role="group" aria-label="Layout">${[['week', 'Week'], ['sidebar', 'Sidebar'], ['today', 'Today'], ['columns', 'Columns'], ['labs', 'Labs']].map(([k, l]) => `<button data-layout="${k}" aria-pressed="${L === k}">${l}</button>`).join('')}</div>
        ${['week', 'sidebar', 'today'].includes(L) ? '<button class="icon-btn b" id="flip" aria-label="Swap days and times" title="Swap days and times">⇄</button>' : ''}</div>
    </div>
    ${body}</div>`;

  el.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { const v = Number(b.dataset.w); st.offset = v === 0 ? 0 : st.offset + v; render(el); });
  el.querySelectorAll('[data-layout]').forEach(b => b.onclick = () => { setPref('layout', b.dataset.layout); render(el); });
  el.querySelectorAll('[data-cd]').forEach(b => b.onclick = () => { st.colDay = Number(b.dataset.cd); render(el); });
  el.querySelectorAll('[data-ld]').forEach(b => b.onclick = () => { st.labDay = Number(b.dataset.ld); render(el); });
  const f = $('#flip'); if (f) f.onclick = () => { setPref('across', st.across === 'days' ? 'times' : 'days'); render(el); };
  el.querySelectorAll('[data-job]').forEach(b => b.onclick = () => { st.sel = b.dataset.job; if (L === 'sidebar') { $('#detail').innerHTML = overview(st.sel); wire($('#detail'), el); } else { modal(overview(st.sel)); wire($('#overlay'), el); } });
  if (L === 'sidebar' && st.sel && db.requests.find(r => r.id === st.sel)) { $('#detail').innerHTML = overview(st.sel); wire($('#detail'), el); }
}

export function overview(id) {
  const r = db.requests.find(x => x.id === id); if (!r) return '';
  const p = r.status === 'done' || r.status === 'ready' ? 2 : r.status === 'in_progress' ? 1 : Number(r.prep) || 0;
  const hz = hazcardsFor(db, r.kit); const cl = clashes(db, r);
  return `<div class="band d${p}"></div><div class="row between"><h2 class="h2">${esc(r.title)}</h2><button class="icon-btn" data-close aria-label="Close">×</button></div>
  <dl class="dl"><dt>When</dt><dd>${esc(nice(r.date))} · ${esc(r.start)}–${esc(r.end)}</dd><dt>Where</dt><dd>${esc(roomName(db, r.room))}${r.room !== r.timetabledRoom && r.timetabledRoom ? ` <span class="muted small">(moved from ${esc(r.timetabledRoom)})</span>` : ''}</dd>
  <dt>Grade</dt><dd>Grade ${esc(gradeOf(r.class))}</dd><dt>Subject</dt><dd>${esc(r.subject)}</dd><dt>Class</dt><dd>${esc(r.class)} · ${esc(r.teacher)}</dd><dt>Sets</dt><dd>${esc(r.sets)}</dd>
  <dt>Kit</dt><dd>${r.kit.slice(0, 4).map(k => esc(k.name)).join(', ')}${r.kit.length > 4 ? ` +${r.kit.length - 4} more` : ''}</dd></dl>
  ${hz.length ? `<div class="chips"><span class="kicker danger">Hazcards</span>${hz.map(h => `<span class="chip danger">${esc(h.code)}</span>`).join('')}</div>` : ''}
  ${cl.length ? `<div class="note bad small">${cl.map(c => `${esc(c.item.name)}: ${c.have} in stock, ${c.need} needed${c.used ? ` + ${c.used} booked by others at this time` : ''}`).join('<br>')}</div>` : ''}
  ${r.status === 'submitted' ? `<div class="note ${r.late ? 'bad' : ''} small"><strong>${r.late ? 'Late request' : 'New request'}.</strong> Sent ${esc(new Date(r.createdAt || r.updatedAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}${r.offer ? ` · offered: ${esc(r.offer)}` : ''}
    <div class="row gap wrap" style="margin-top:8px"><button class="btn small pri" data-act="accept">Accept</button><button class="btn small" data-act="offer">Change day / time</button><button class="btn small danger-outline" data-act="reject">Reject</button></div></div>` : ''}
  ${r.notes ? `<p class="small"><strong>Teacher’s note:</strong> ${esc(r.notes)}</p>` : ''}
  <div class="row gap"><button class="swatch d0${p === 0 ? ' on' : ''}" data-prep="0" aria-label="Mark not started" aria-pressed="${p === 0}"></button><button class="swatch d1${p === 1 ? ' on' : ''}" data-prep="1" aria-label="Mark in progress" aria-pressed="${p === 1}"></button><button class="swatch d2${p === 2 ? ' on' : ''}" data-prep="2" aria-label="Mark prepared" aria-pressed="${p === 2}"></button>
  <a class="btn pri" style="margin-left:auto" href="#/prep/${esc(r.id)}">Prepare</a></div>`;
}

export function wire(root, el, id = st.sel) {
  const r = db.requests.find(x => x.id === id); if (!r) return;
  const done = async (patch, msg) => { try { await call('updateRequest', { id: r.id, patch }); toast(msg); closeModal(); await reload(); } catch (e) { toast(e.message, 'bad'); } };
  root.querySelectorAll('[data-prep]').forEach(b => b.onclick = () => { const k = Number(b.dataset.prep);
    done({ prep: k, status: k === 2 ? 'ready' : k === 1 ? 'in_progress' : (r.status === 'submitted' ? 'submitted' : 'accepted') }, ['Not started', 'In progress', 'Prepared'][k]); });
  root.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
    const a = b.dataset.act;
    if (a === 'accept') done({ status: 'accepted', late: r.late, offer: '' }, 'Accepted');
    if (a === 'reject') { const v = await promptBox('Reject this request?', [{ name: 'techNotes', label: 'Reason for the teacher' }], 'Reject'); if (v) done({ status: 'rejected', techNotes: v.techNotes }, 'Rejected'); }
    if (a === 'offer') { const v = await promptBox('Offer another day or time', [{ name: 'offer', label: 'What can you do? e.g. “Thu 26 Nov 14:00 in S4.05”' }], 'Send to teacher'); if (v && v.offer) done({ offer: v.offer }, 'Offer sent'); }
  });
}
