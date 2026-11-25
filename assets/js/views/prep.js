import { db, session, call } from '../store.js';
import { esc, niceLong, hazcardsFor, roomName, clashes, gradeOf } from '../logic.js';
import { $, hazcardModal, toast, promptBox, statusChip, iconImg } from '../ui.js';
import { reload } from '../app.js';

const seen = new Set(); let showWhere = true; const picked = {};

export async function render(el, [id]) {
  const r = db.requests.find(x => x.id === id);
  if (!r) { el.innerHTML = '<div class="page"><p class="empty">Request not found.</p></div>'; return; }
  const hz = hazcardsFor(db, r.kit); const cl = clashes(db, r); const isStaff = session.me.role !== 'teacher';
  const p = r.status === 'done' || r.status === 'ready' ? 2 : r.status === 'in_progress' ? 1 : Number(r.prep) || 0;
  picked[id] = picked[id] || {};
  el.innerHTML = `<div class="page">
    <a href="#/week" class="small no-print">‹ Week</a>
    <div class="row between wrap"><div><div class="kicker">PREP SHEET</div><h1 class="h1">${esc(r.title)}</h1>
      <p class="muted">${esc(niceLong(r.date))} · ${esc(r.start)}–${esc(r.end)} · ${esc(roomName(db, r.room))} · Grade ${esc(gradeOf(r.class))} ${esc(r.subject)} · ${esc(r.class)} · ${esc(r.teacher)} · <strong>${esc(r.sets)} sets</strong></p></div>${statusChip(r.status)}</div>
    ${r.status === 'submitted' && isStaff ? `<div class="banner ${r.late ? 'bad' : ''} no-print"><strong>${r.late ? 'Late request' : 'New request'}.</strong> ${r.offer ? 'You offered: ' + esc(r.offer) + '. ' : ''}<div class="row gap wrap"><button class="btn pri small" data-act="accept">Accept</button><button class="btn small" data-act="offer">Change day / time</button><button class="btn small danger-outline" data-act="reject">Reject</button></div></div>` : ''}
    ${hz.length ? `<div class="chips"><span class="kicker danger">Hazcards</span>${hz.map(h => `<button class="chip danger" data-hz="${esc(h.code)}">${esc(h.code)}${h.title ? ' · ' + esc(h.title) : ''}</button>`).join('')}</div>` : ''}
    ${cl.length ? `<div class="note bad">${cl.map(c => `<strong>${esc(c.item.name)}</strong>: ${c.have} in stock, ${c.need} needed${c.used ? `, plus ${c.used} booked at the same time (${c.others.map(o => esc(o.r.teacher + ' · ' + o.r.room)).join(', ')})` : ''}`).join('<br>')}</div>` : ''}
    ${r.notes ? `<div class="note"><strong>Teacher’s note:</strong> ${esc(r.notes)}</div>` : ''}
    <section class="card stack">
      <div class="row between wrap"><h2 class="h2">Pick list</h2>
        <label class="switch no-print"><span>Show where (cabinet)</span><input type="checkbox" id="where" ${showWhere ? 'checked' : ''}></label></div>
      <div class="scroll"><table class="tbl"><thead><tr><th class="no-print">✓</th><th></th><th>Item</th><th>Total</th>${showWhere ? '<th>Where</th>' : ''}</tr></thead><tbody>
      ${r.kit.map((k, i) => { const it = db.inventory.find(x => x.id === k.itemId) || {};
        const where = Object.entries(it.rooms || {}).filter(([, q]) => Number(q) > 0).map(([room, q]) => `${esc(roomName(db, room))}${it.storage?.[room] ? ' › ' + esc(it.storage[room]) : ''} <span class="muted">(${esc(q)})</span>`).join('<br>');
        return `<tr><td class="no-print"><input type="checkbox" data-pick="${i}" ${picked[id][i] ? 'checked' : ''} aria-label="Picked ${esc(k.name)}"></td><td>${iconImg(it, 32)}</td>
          <td>${esc(k.name)}${it.hazcards?.length ? ` <span class="pill danger small">${esc(it.hazcards.join(', '))}</span>` : ''}</td><td><strong>${esc(k.qty)}</strong></td>${showWhere ? `<td class="small">${where || '<span class="muted">not in inventory</span>'}</td>` : ''}</tr>`; }).join('')}
      </tbody></table></div>
    </section>
    ${isStaff ? `<section class="card stack no-print"><h2 class="h2">Status</h2>
      <div class="row gap wrap"><button class="swatch d0${p === 0 ? ' on' : ''}" data-prep="0" aria-label="Not started" aria-pressed="${p === 0}"></button><button class="swatch d1${p === 1 ? ' on' : ''}" data-prep="1" aria-label="In progress" aria-pressed="${p === 1}"></button><button class="swatch d2${p === 2 ? ' on' : ''}" data-prep="2" aria-label="Prepared" aria-pressed="${p === 2}"></button>
      <button class="btn" id="print">Print sheet + labels</button>${r.status !== 'done' ? '<button class="btn" id="done">Mark done (after the lesson)</button>' : ''}</div>
      <label class="fld">Technician notes (breakages, returns)<textarea id="tn" rows="2">${esc(r.techNotes || '')}</textarea></label><div><button class="btn small" id="saveTn">Save notes</button></div></section>` : ''}
    <section class="labels print-only">${r.kit.filter(k => (db.inventory.find(x => x.id === k.itemId) || {}).list === 'Chemicals').map(k => `<div class="label"><strong>${esc(k.name)}</strong><span>${esc(r.class)} · ${esc(r.date)}</span><span>${esc((db.inventory.find(x => x.id === k.itemId) || {}).hazcards?.join(', ') || '')}</span></div>`).join('')}</section>
  </div>`;

  if (hz.length && isStaff && !seen.has(id)) { seen.add(id); hazcardModal(hz, `READ BEFORE PREPARING · ${hz.length} HAZCARD${hz.length > 1 ? 'S' : ''}`); }
  el.querySelectorAll('[data-hz]').forEach(b => b.onclick = () => { const i = hz.findIndex(h => h.code === b.dataset.hz); hazcardModal(hz.slice(i).concat(hz.slice(0, i)), 'HAZCARD'); });
  $('#where').onchange = e => { showWhere = e.target.checked; render(el, [id]); };
  el.querySelectorAll('[data-pick]').forEach(c => c.onchange = () => { picked[id][c.dataset.pick] = c.checked; });
  const upd = async (patch, msg) => { try { await call('updateRequest', { id, patch }); toast(msg); await reload(); } catch (e) { toast(e.message, 'bad'); } };
  el.querySelectorAll('[data-prep]').forEach(b => b.onclick = () => { const k = Number(b.dataset.prep); upd({ prep: k, status: k === 2 ? 'ready' : k === 1 ? 'in_progress' : 'accepted' }, ['Not started', 'In progress', 'Prepared'][k]); });
  el.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
    const a = b.dataset.act;
    if (a === 'accept') upd({ status: 'accepted', offer: '' }, 'Accepted');
    if (a === 'reject') { const v = await promptBox('Reject this request?', [{ name: 'techNotes', label: 'Reason for the teacher' }], 'Reject'); if (v) upd({ status: 'rejected', techNotes: v.techNotes }, 'Rejected'); }
    if (a === 'offer') { const v = await promptBox('Offer another day or time', [{ name: 'offer', label: 'What can you do?' }], 'Send'); if (v && v.offer) upd({ offer: v.offer }, 'Offer sent'); }
  });
  const pr = $('#print'); if (pr) pr.onclick = () => window.print();
  const dn = $('#done'); if (dn) dn.onclick = () => upd({ status: 'done', prep: 2 }, 'Recorded as done');
  const tn = $('#saveTn'); if (tn) tn.onclick = () => upd({ techNotes: $('#tn').value }, 'Notes saved');
}
