import { db, session, call } from '../store.js';
import { esc, iso, nice, deadline, roomName } from '../logic.js';
import { statusChip, toast, confirmBox, promptBox } from '../ui.js';
import { reload } from '../app.js';

export async function render(el) {
  const me = session.me; const today = iso(new Date());
  const mine = db.requests.filter(r => r.teacherEmail === me.email || r.teacher === me.name);
  const upcoming = mine.filter(r => r.date >= today && !['cancelled', 'rejected'].includes(r.status));
  const feedback = mine.filter(r => r.date < today && ['done', 'ready', 'accepted', 'in_progress'].includes(r.status) && !r.rating);
  const offers = mine.filter(r => r.offer && r.status === 'submitted');
  const count = s => mine.filter(r => r.date >= today && r.status === s).length;
  const lead = db.settings.leadDays;
  el.innerHTML = `
  <div class="page">
    <div class="row between wrap">
      <div><div class="muted">${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</div><h1 class="h1">Your practicals</h1></div>
      <div class="row gap wrap"><a class="btn" href="#/library">Practical library</a><a class="btn pri" href="#/order">Order a practical</a></div>
    </div>
    <div class="stats">
      ${[['Drafts', count('draft')], ['With technicians', count('submitted')], ['Accepted', count('accepted') + count('in_progress')], ['Ready', count('ready')], ['Feedback due', feedback.length]].map(([l, n]) => `<div class="stat"><span>${l}</span><strong>${n}</strong></div>`).join('')}
    </div>
    <div class="cols">
      <section class="card grow">
        <h2 class="h2">Coming up</h2>
        ${upcoming.length ? upcoming.map(r => `
          <article class="req">
            <div class="row between wrap"><div><strong>${esc(r.title)}</strong><div class="muted small">${esc(r.class)} · ${esc(nice(r.date))} · ${esc(r.start)}–${esc(r.end)} · ${esc(roomName(db, r.room))} · ${esc(r.sets)} sets</div></div>${statusChip(r.status)}</div>
            ${r.late ? '<div class="note warn small">Late request</div>' : ''}
            ${r.offer ? `<div class="note small">The technicians suggest <strong>${esc(r.offer)}</strong>. <button class="linkbtn" data-accept-offer="${esc(r.id)}">Accept</button></div>` : ''}
            <div class="row gap small">
              ${r.status === 'draft' ? `<a class="linkbtn" href="#/order?id=${esc(r.id)}">Continue draft</a>` : `<a class="linkbtn" href="#/order?id=${esc(r.id)}">Change</a>`}
              <button class="linkbtn danger" data-cancel="${esc(r.id)}">Cancel</button>
            </div>
          </article>`).join('') : '<p class="muted">Nothing booked yet.</p>'}
      </section>
      <aside class="side">
        ${feedback.length ? `<section class="card"><h2 class="h2">How did it go?</h2>${feedback.slice(0, 5).map(r => `<div class="req"><strong>${esc(r.title)}</strong><div class="muted small">${esc(r.class)} · ${esc(nice(r.date))}</div><button class="btn small" data-fb="${esc(r.id)}">Give feedback</button></div>`).join('')}</section>` : ''}
        <section class="card"><h2 class="h2">Booking rules</h2><ul class="small">
          <li>Book ${lead} working days ahead.</li>
          <li>Monday practical → book by the end of Wednesday before. Today’s cut-off is for <strong>${esc(nice(nextBookable(today, lead)))}</strong>.</li>
          <li>Late? You can still send it — the technicians decide.</li></ul></section>
      </aside>
    </div>
  </div>`;
  el.onclick = async e => {
    const c = e.target.closest('[data-cancel]'), f = e.target.closest('[data-fb]'), o = e.target.closest('[data-accept-offer]');
    if (c && await confirmBox('Cancel this practical?', 'Cancel it')) { await call('updateRequest', { id: c.dataset.cancel, patch: { status: 'cancelled' } }); toast('Cancelled'); reload(); }
    if (f) {
      const v = await promptBox('Feedback', [{ name: 'rating', label: 'Rating (1–5)', options: ['5', '4', '3', '2', '1'], value: '4' }, { name: 'feedback', label: 'Notes (breakages, what to change next time)' }], 'Send');
      if (v) { await call('updateRequest', { id: f.dataset.fb, patch: { rating: Number(v.rating), feedback: v.feedback, status: 'done' } }); toast('Thanks — saved to the library'); reload(); }
    }
    if (o) {
      const r = db.requests.find(x => x.id === o.dataset.acceptOffer);
      await call('updateRequest', { id: r.id, patch: { lateChoice: 'offer accepted', status: 'submitted' } }); toast('Accepted — the technicians will update the time'); reload();
    }
  };
}
function nextBookable(today, lead) {
  // first school day whose deadline is still today or later
  const d = new Date(); for (let i = 1; i < 21; i++) { const x = new Date(d); x.setDate(d.getDate() + i); const s = iso(x); if (x.getDay() % 6 && deadline(s, lead, db.settings.holidays) >= today) return s; }
  return today;
}
