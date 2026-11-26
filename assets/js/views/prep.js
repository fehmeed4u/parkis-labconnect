import { db, session, call } from '../store.js';
import { esc, nice, niceLong, hazcardsFor, roomName, clashes, unavailable, gradeOf, prepOf } from '../logic.js';
import { hazcardModal, toast, promptBox, statusChip, iconImg } from '../ui.js';
import { reload } from '../app.js';

const seen = new Set(); let showWhere = true; const picked = {};
const whereOf = it => Object.entries(it.rooms || {}).filter(([, q]) => Number(q) > 0)
  .map(([room, q]) => `${esc(roomName(db, room))}${it.storage?.[room] ? ' › ' + esc(it.storage[room]) : ''} <span class="muted">(${esc(q)})</span>`).join('<br>');

/** Full-page prep sheet (#/prep/:id) — also what gets printed. */
export async function render(el, [id]) {
  const r = db.requests.find(x => x.id === id);
  if (!r) { el.innerHTML = '<div class="page"><p class="empty">Request not found.</p></div>'; return; }
  el.innerHTML = `<div class="page" style="max-width:1100px"><a href="#/requests/${esc(id)}" class="small no-print">‹ Request queue</a><section class="card sheet">${sheet(r)}</section></div>`;
  wireSheet(el, r, () => render(el, [id]));
}

/** The prep sheet body: header + actions, hazcards, shortages, pick list, chemicals, footer. */
export function sheet(r) {
  const hz = hazcardsFor(db, r.kit); const cl = clashes(db, r); const isStaff = session.me.role !== 'teacher';
  const p = prepOf(r); picked[r.id] = picked[r.id] || {};
  const items = r.kit.map((k, i) => ({ k, i, it: db.inventory.find(x => x.id === k.itemId) || {} }));
  const equip = items.filter(x => x.it.list !== 'Chemicals'), chems = items.filter(x => x.it.list === 'Chemicals');
  const free = x => { const c = cl.find(c => c.item.id === x.k.itemId); return c ? Math.max(0, c.have - c.used) : null; };
  return `
    <div class="row between wrap" style="align-items:flex-start">
      <div><div class="kicker">Prep sheet · ${esc(String(r.id).toUpperCase())}</div>
        <h2 class="h2" style="font-family:var(--display);font-size:24px;margin-top:4px">${esc(r.title)}</h2>
        <div class="muted" style="margin-top:4px">${esc(r.teacher)} · ${esc(r.class)} · ${esc(niceLong(r.date))} · ${esc(r.start)}–${esc(r.end)} · ${esc(roomName(db, r.room))} · <strong>${esc(r.sets)} groups</strong></div></div>
      <div class="row gap wrap no-print">${isStaff && r.status === 'submitted' ? `<button class="btn" data-act="query">Query</button><button class="btn danger-outline" data-act="reject">Reject</button><button class="btn pri" data-act="accept">Accept &amp; reserve stock</button>`
        : statusChip(r.status, r)}</div>
    </div>
    ${r.status === 'submitted' && r.late ? `<div class="note bad"><strong>Late request.</strong> Sent ${esc(new Date(r.createdAt || r.updatedAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}${r.offer ? ' · you offered: ' + esc(r.offer) : ''}. <button class="linkbtn danger" data-act="offer">Offer another day / time</button></div>` : ''}
    ${hz.length ? `<div class="chips"><span class="kicker danger" style="margin-right:4px">Hazcards</span>${hz.map(h => `<button class="chip hz" data-hz="${esc(h.code)}">${esc(h.code)}${h.title ? ' · ' + esc(h.title) : ''}</button>`).join('')}</div>` : ''}
    ${(un => un.length ? `<div class="short"><span><strong>Not in our inventory:</strong> ${un.map(u => `${esc(u.name)} × ${esc(u.qty)}${u.reason === 'none in stock' ? ' (none in stock)' : ''}`).join(', ')}. The teacher sent it anyway — order, borrow or suggest a swap.</span>
      ${isStaff ? `<button class="btn small no-print" data-act="query" data-q="${esc(`We don't have ${un.map(u => u.name).join(', ')}. Could you use something else, or should we try to order it in time?`)}">Ask the teacher</button>` : ''}</div>` : '')(unavailable(db, r))}
    ${cl.map(c => `<div class="short"><span><strong>Short ${Math.max(1, c.need + c.used - c.have)} × ${esc(c.item.name)}.</strong> ${c.have} in stock, ${c.used} booked at the same time${c.others.length ? ' (' + c.others.map(o => esc(o.r.teacher + ' · ' + o.r.room)).join(', ') + ')' : ''}.</span>
      ${isStaff ? `<button class="btn small no-print" data-act="query" data-q="${esc(`Only ${Math.max(0, c.have - c.used)} × ${c.item.name} free at that time. Run fewer groups, or move the lesson?`)}">Ask the teacher</button>` : ''}</div>`).join('')}
    ${r.query ? `<div class="note query"><strong>You asked the teacher:</strong> ${esc(r.query)}</div>` : ''}
    ${r.reply ? `<div class="note ok"><strong>Teacher replied:</strong> ${esc(r.reply)}</div>` : ''}
    ${r.notes ? `<div class="note"><strong>Teacher’s note:</strong> ${esc(r.notes)}</div>` : ''}
    <div>
      <div class="row between wrap" style="margin-bottom:10px"><h3 class="h3" style="margin:0">Equipment — pick list</h3>
        <label class="switch no-print"><span>Show where (cabinet)</span><input type="checkbox" data-where ${showWhere ? 'checked' : ''}></label></div>
      <div class="scroll"><table class="tbl boxed"><thead><tr><th class="no-print" style="width:70px">Picked</th><th>Item</th><th>Qty</th>${showWhere ? '<th>Where</th>' : ''}</tr></thead><tbody>
      ${equip.map(x => { const f = free(x); return `<tr><td class="no-print"><input type="checkbox" data-pick="${x.i}" ${picked[r.id][x.i] ? 'checked' : ''} aria-label="Picked ${esc(x.k.name)}"></td>
        <td><span class="row gap">${iconImg(x.it, 28)}<span>${esc(x.k.name)}</span></span></td><td><strong>${esc(x.k.qty)}</strong>${f !== null ? ` <span class="bad-t">(${f} available)</span>` : ''}</td>
        ${showWhere ? `<td class="where">${whereOf(x.it) || '<span class="muted">not in inventory</span>'}</td>` : ''}</tr>`; }).join('') || `<tr><td colspan="4" class="muted">No equipment listed.</td></tr>`}
      </tbody></table></div>
    </div>
    ${chems.length ? `<div><h3 class="h3">Chemicals and solutions to make up</h3><div class="solutions">${chems.map(x => `<div class="sol"><b>${esc(x.k.name)}${x.it.size ? ' · ' + esc(x.it.size) : ''} · ${esc(x.k.qty)} for ${esc(r.sets)} groups</b>
      ${whereOf(x.it) ? 'Stock: ' + whereOf(x.it) + '<br>' : ''}${x.it.hazcards?.length ? 'Hazcard ' + esc(x.it.hazcards.join(', ')) : ''}${x.it.storageGroup ? ' · storage group ' + esc(x.it.storageGroup) : ''}
      <label class="check no-print" style="margin-top:8px;font-size:13px"><input type="checkbox" data-pick="${x.i}" ${picked[r.id][x.i] ? 'checked' : ''}> Made up</label></div>`).join('')}</div></div>` : ''}
    ${isStaff ? `<div class="no-print"><label class="fld">Technician notes (breakages, returns)<textarea data-tn rows="2">${esc(r.techNotes || '')}</textarea></label><div style="margin-top:8px"><button class="btn small" data-save-tn>Save notes</button></div></div>
    <div class="sheet-foot no-print">
      <button class="btn" data-print>Print ${esc(r.sets)} tray cards</button>
      ${r.status !== 'submitted' ? `<div class="seg" role="group" aria-label="Preparation"><button data-prep="0" aria-pressed="${p === 0}">Not started</button><button data-prep="1" aria-pressed="${p === 1}">In progress</button><button data-prep="2" aria-pressed="${p === 2}">Ready</button></div>` : ''}
      ${r.status !== 'submitted' && p < 2 ? '<button class="btn pri" data-prep="2">Mark ready</button>' : ''}
      ${r.status !== 'done' && r.status !== 'submitted' ? '<button class="btn" data-done>Mark done (after the lesson)</button>' : ''}
      <a class="btn" href="#/order?id=${esc(r.id)}">Edit request</a>
    </div>` : ''}
    <section class="labels print-only">${Array.from({ length: Number(r.sets) || 0 }, (_, g) => `<div class="label"><strong>${esc(r.title)} · tray ${g + 1}</strong><span>${esc(r.class)} · ${esc(nice(r.date))} ${esc(r.start)} · ${esc(roomName(db, r.room))}</span><span>${r.kit.map(k => esc(k.name)).join(', ')}</span></div>`).join('')}</section>`;
}

export function wireSheet(root, r, rerender) {
  const id = r.id; const hz = hazcardsFor(db, r.kit); const isStaff = session.me.role !== 'teacher';
  const uses = {}; r.kit.forEach(k => (db.inventory.find(i => i.id === k.itemId)?.hazcards || []).forEach(c => { uses[c] = uses[c] ? uses[c] + ', ' + k.name : k.name; }));
  if (hz.length && isStaff && !seen.has(id) && r.status !== 'done') { seen.add(id); hazcardModal(hz, `Read before preparing · ${hz.length} hazcard${hz.length > 1 ? 's' : ''} for this practical`, 'I’ve read these', uses); }
  root.querySelectorAll('[data-hz]').forEach(b => b.onclick = () => { const i = hz.findIndex(h => h.code === b.dataset.hz); hazcardModal(hz.slice(i).concat(hz.slice(0, i)), 'Hazcard', 'Close', uses); });
  const w = root.querySelector('[data-where]'); if (w) w.onchange = e => { showWhere = e.target.checked; rerender(); };
  root.querySelectorAll('[data-pick]').forEach(c => c.onchange = () => { picked[id][c.dataset.pick] = c.checked; });
  const upd = async (patch, msg) => { try { await call('updateRequest', { id, patch }); toast(msg); await reload(); } catch (e) { toast(e.message, 'bad'); } };
  root.querySelectorAll('[data-prep]').forEach(b => b.onclick = () => { const k = Number(b.dataset.prep); upd({ prep: k, status: k === 2 ? 'ready' : k === 1 ? 'in_progress' : 'accepted' }, ['Not started', 'In progress', 'Ready'][k]); });
  root.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
    const a = b.dataset.act;
    if (a === 'accept') upd({ status: 'accepted', offer: '', query: '' }, 'Accepted — stock reserved');
    if (a === 'reject') { const v = await promptBox('Reject this request?', [{ name: 'techNotes', label: 'Reason for the teacher' }], 'Reject'); if (v) upd({ status: 'rejected', techNotes: v.techNotes }, 'Rejected'); }
    if (a === 'offer') { const v = await promptBox('Offer another day or time', [{ name: 'offer', label: 'What can you do? e.g. “Thu 26 Nov 14:00 in S4.05”' }], 'Send to teacher'); if (v && v.offer) upd({ offer: v.offer }, 'Offer sent'); }
    if (a === 'query') { const v = await promptBox('Ask the teacher a question', [{ name: 'query', label: 'Your question', value: b.dataset.q || r.query || '' }], 'Send query'); if (v && v.query) upd({ query: v.query, reply: '' }, 'Query sent'); }
  });
  const pr = root.querySelector('[data-print]'); if (pr) pr.onclick = () => window.print();
  const dn = root.querySelector('[data-done]'); if (dn) dn.onclick = () => upd({ status: 'done', prep: 2 }, 'Recorded as done');
  const tn = root.querySelector('[data-save-tn]'); if (tn) tn.onclick = () => upd({ techNotes: root.querySelector('[data-tn]').value }, 'Notes saved');
}
