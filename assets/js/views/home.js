import { db, session, call } from '../store.js';
import { esc, iso, nice, parse, deadline, roomName, gradeOf, stageOf, STAGES } from '../logic.js';
import { statusChip, toast, confirmBox, promptBox } from '../ui.js';
import { reload } from '../app.js';

export const mineOf = me => db.requests.filter(r => r.teacherEmail === me.email || r.teacher === me.name);
const isOpen = r => !['cancelled', 'rejected', 'done'].includes(r.status);

export async function render(el) {
  const me = session.me; const today = iso(new Date());
  const mine = mineOf(me);
  const upcoming = mine.filter(r => (r.date >= today || r.status === 'draft') && !['cancelled', 'rejected'].includes(r.status));
  const feedback = mine.filter(r => r.date < today && ['done', 'ready', 'accepted', 'in_progress'].includes(r.status) && !r.rating);
  const queried = mine.filter(r => isOpen(r) && (r.query || (r.offer && r.status === 'submitted')));
  const live = r => r.date >= today && isOpen(r) && !r.query;
  const lead = db.settings.leadDays;
  const counts = [['Drafts', mine.filter(r => r.status === 'draft').length], ['With technician', mine.filter(r => live(r) && ['submitted', 'accepted', 'in_progress'].includes(r.status)).length],
    ['Queried', queried.length], ['Ready', mine.filter(r => live(r) && r.status === 'ready').length], ['Feedback due', feedback.length]];

  el.innerHTML = `
  <div class="page">
    <header class="page-head">
      <div><div class="eyebrow">${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</div><h1 class="h1">Your practicals</h1></div>
      <div class="row gap wrap"><a class="btn" href="#/library">Rebook from last year</a><a class="btn pri" href="#/order">Order a practical</a></div>
    </header>
    <section class="stats" aria-label="Request counts">
      ${counts.map(([l, n]) => `<div class="stat"><span>${l}</span><strong>${n}</strong></div>`).join('')}
    </section>
    <div class="cols">
      <section class="card main-col" style="gap:0">
        <div class="card-head"><h2 class="h2">Coming up</h2><a href="#/requests" class="small">All requests</a></div>
        <div class="stack">
        ${upcoming.length ? upcoming.slice(0, 12).map(r => { const s = stageOf(r, today); const q = r.query || (r.offer && r.status === 'submitted');
          return `<article class="req">
            <div class="row between wrap" style="align-items:flex-start"><div><div class="req-title">${esc(r.title)}</div>
              <div class="req-meta">Grade ${esc(gradeOf(r.class))} · ${esc(r.class)} · ${esc(nice(r.date))} · ${esc(r.start)}–${esc(r.end)} · ${esc(roomName(db, r.room))} · ${esc(r.sets)} groups</div></div>${statusChip(r.status, r)}</div>
            <div class="steps${q ? ' q' : ''}" role="img" aria-label="Stage ${s} of 7: ${STAGES[s - 1]}">${STAGES.map((_, i) => `<i class="${i < s ? 'on' : ''}"></i>`).join('')}</div>
            ${r.query ? `<div class="note query">Technician asked a question — reply to keep this on track.</div>` : ''}
            ${r.offer && r.status === 'submitted' ? `<div class="note query">The technicians suggest <strong>${esc(r.offer)}</strong>. <button class="linkbtn" data-accept-offer="${esc(r.id)}">Accept</button></div>` : ''}
            ${r.late && r.status === 'submitted' ? '<div class="note warn">Late request — the technicians will decide.</div>' : ''}
            ${r.status === 'rejected' ? `<div class="note bad">Rejected${r.techNotes ? ': ' + esc(r.techNotes) : ''}</div>` : ''}
            <div class="row gap small">
              <a class="linkbtn" href="#/order?id=${esc(r.id)}">${r.status === 'draft' ? 'Continue draft' : 'Change'}</a>
              <button class="linkbtn danger" data-cancel="${esc(r.id)}">Cancel</button>
            </div>
          </article>`; }).join('') : '<p class="muted">Nothing booked yet. <a href="#/order">Order a practical</a> or pick one from the <a href="#/library">library</a>.</p>'}
        </div>
        <div class="step-legend" aria-hidden="true">${STAGES.map(x => `<span>${x}</span>`).join('<span>›</span>')}</div>
      </section>
      <aside class="side-col" style="gap:24px">
        <section class="card"><h2 class="h2" style="margin-bottom:14px">Needs your action</h2><div class="stack">
          ${queried.map(r => `<div class="action query"><div class="kicker">${r.query ? 'Query from technician' : 'New time offered'}</div>
            <div>${esc(r.title)}, ${esc(r.class)}: ${esc(r.query || ('they suggest ' + r.offer))}</div>
            <div class="row gap">${r.query ? `<button class="btn pri small" data-reply="${esc(r.id)}">Reply</button>` : `<button class="btn pri small" data-accept-offer="${esc(r.id)}">Accept</button><a class="btn small" href="#/order?id=${esc(r.id)}">Change</a>`}</div></div>`).join('')}
          ${feedback.slice(0, 4).map(r => `<div class="action"><div class="kicker">Feedback due</div><div>${esc(r.title)}, ${esc(r.class)} — how did it go?</div>
            <div class="row"><button class="btn small" data-fb="${esc(r.id)}">Rate in 30 seconds</button></div></div>`).join('')}
          ${!queried.length && !feedback.length ? '<p class="muted small">Nothing right now.</p>' : ''}
        </div></section>
        <section class="card"><h2 class="h2" style="margin-bottom:6px">Booking rules</h2><ul class="rules">
          <li>Book ${lead} working days ahead</li>
          <li>Monday practical → book by end of ${esc(parse(deadline('2024-01-08', lead, [])).toLocaleDateString('en-GB', { weekday: 'long' }))} before</li>
          <li>Next lesson you can still book on time: <strong>${esc(nice(nextBookable(today, lead)))}</strong></li>
          <li>Late? You can still send it — the technicians decide</li></ul></section>
      </aside>
    </div>
  </div>`;
  el.onclick = async e => {
    const c = e.target.closest('[data-cancel]'), f = e.target.closest('[data-fb]'), o = e.target.closest('[data-accept-offer]'), q = e.target.closest('[data-reply]');
    try {
      if (c && await confirmBox('Cancel this practical?', 'Cancel it')) { await call('updateRequest', { id: c.dataset.cancel, patch: { status: 'cancelled' } }); toast('Cancelled'); reload(); }
      if (f) {
        const v = await promptBox('How did it go?', [{ name: 'rating', label: 'Rating (1–5)', options: ['5', '4', '3', '2', '1'], value: '4' }, { name: 'feedback', label: 'Notes (breakages, what to change next time)' }], 'Send');
        if (v) { await call('updateRequest', { id: f.dataset.fb, patch: { rating: Number(v.rating), feedback: v.feedback, status: 'done' } }); toast('Thanks — saved to the library'); reload(); }
      }
      if (o) { await call('updateRequest', { id: o.dataset.acceptOffer, patch: { lateChoice: 'offer accepted', status: 'submitted' } }); toast('Accepted — the technicians will update the time'); reload(); }
      if (q) {
        const r = db.requests.find(x => x.id === q.dataset.reply);
        const v = await promptBox('Reply to the technicians', [{ name: 'reply', label: r.query }], 'Send reply');
        if (v && v.reply) { await call('updateRequest', { id: r.id, patch: { reply: v.reply, query: '', status: 'submitted' } }); toast('Reply sent'); reload(); }
      }
    } catch (err) { toast(err.message, 'bad'); }
  };
}
function nextBookable(today, lead) {
  // first school day whose deadline is still today or later
  const d = new Date(); for (let i = 1; i < 21; i++) { const x = new Date(d); x.setDate(d.getDate() + i); const s = iso(x); if (x.getDay() % 6 && deadline(s, lead, db.settings.holidays) >= today) return s; }
  return today;
}
