import { db, session, call } from '../store.js';
import { esc, totalStock, roomName, toCSV } from '../logic.js';
import { $, modal, closeModal, toast, promptBox, confirmBox, iconImg, download } from '../ui.js';
import { reload } from '../app.js';

const st = { list: 'Equipment', q: '', room: '', flag: '', view: 'list', where: true, limit: 60 };
const LISTS = ['Equipment', 'Chemicals', 'Consumables', 'Microscope slides', 'Temporary', 'Stationery', 'Models', 'Documents'];
const REASONS = ['Broken', 'Lost', 'Used up', 'New stock arrived', 'Stocktake correction', 'Moved to another room'];

export async function render(el) {
  const canEdit = session.me.role !== 'teacher';
  const below = i => Number(i.min) > 0 && totalStock(i) < Number(i.min);
  let items = db.inventory.filter(i => i.list === st.list);
  if (st.q) { const w = st.q.toLowerCase().split(/\s+/); items = db.inventory.filter(i => w.every(x => (i.name + ' ' + i.size + ' ' + i.category + ' ' + i.supplier + ' ' + i.ref).toLowerCase().includes(x))); }
  if (st.room) items = items.filter(i => Number(i.rooms[st.room]) > 0);
  if (st.flag === 'low') items = items.filter(below);
  if (st.flag === 'order') items = items.filter(i => i.orderRequired === true || i.orderRequired === 'TRUE');
  items.sort((a, b) => a.name.localeCompare(b.name) || String(a.size).localeCompare(String(b.size), undefined, { numeric: true }));
  const rooms = db.labs.filter(l => l.type !== 'classroom');
  const shown = items.slice(0, st.limit);
  const statusOf = i => (i.orderRequired === true || i.orderRequired === 'TRUE') ? ['Order required', 'st-rejected'] : below(i) ? ['Below minimum', 'st-submitted'] : ['OK', 'st-ready'];

  el.innerHTML = `<div class="page wide">
    <div class="row between wrap"><div><h1 class="h1">What’s in our labs</h1><p class="muted">${db.inventory.length} items across ${LISTS.length} lists. ${canEdit ? 'Technicians and HOD can add, change and remove.' : '<strong>View only</strong> — tell the technicians if something is wrong or missing.'}</p></div>
      <div class="row gap wrap">${canEdit ? '<button class="btn" id="log">Change log</button><button class="btn pri" id="add">+ Add item</button>' : ''}<button class="btn" id="exp">Export CSV</button></div></div>
    <div class="stats">${[['Below minimum', db.inventory.filter(below).length, 'low'], ['Marked “order required”', db.inventory.filter(i => i.orderRequired === true || i.orderRequired === 'TRUE').length, 'order']].map(([l, n, f]) => `<button class="stat${st.flag === f ? ' on' : ''}" data-flag="${f}"><span>${l}</span><strong>${n}</strong></button>`).join('')}</div>
    <div class="tabs" role="tablist">${LISTS.map(l => `<button role="tab" aria-selected="${!st.q && st.list === l}" data-list="${esc(l)}">${esc(l)} <span class="muted">${db.inventory.filter(i => i.list === l).length}</span></button>`).join('')}</div>
    <div class="row gap wrap">
      <input id="q" type="search" placeholder="Search all lists: beaker, multimeter, NaOH…" value="${esc(st.q)}" class="grow" style="max-width:380px">
      <select id="room" aria-label="Room"><option value="">All rooms</option>${rooms.map(r => `<option value="${esc(r.room)}"${st.room === r.room ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
      <div class="seg" role="group" aria-label="View"><button data-view="list" aria-pressed="${st.view === 'list'}">List</button><button data-view="pics" aria-pressed="${st.view === 'pics'}">Pictures</button></div>
      <label class="switch"><span>Show where (cabinet)</span><input type="checkbox" id="where" ${st.where ? 'checked' : ''}></label>
    </div>
    <p class="muted small">${items.length} match${items.length === 1 ? '' : 'es'}${st.q ? ` for “${esc(st.q)}” in all lists` : ` in ${esc(st.list)}`}${st.room ? ' · ' + esc(roomName(db, st.room)) : ''}${st.flag ? ' · ' + (st.flag === 'low' ? 'below minimum' : 'order required') : ''}.</p>
    ${st.view === 'pics' ? `<div class="grid-pics">${shown.map(i => `<button class="pic" data-item="${esc(i.id)}"><span class="pimg${i.icon || i.photo ? '' : ' none'}">${i.icon || i.photo ? iconImg(i, 64) : 'No picture yet'}</span><strong>${esc(i.name)}${i.size ? ' · ' + esc(i.size) : ''}</strong><span class="muted small">${esc(totalStock(i))} · ${Object.keys(i.rooms).filter(r => Number(i.rooms[r]) > 0).map(r => esc(roomName(db, r))).join(', ')}</span></button>`).join('')}</div>`
    : `<div class="stack">${shown.map(i => { const [sl, sc] = statusOf(i); const rs = Object.entries(i.rooms).filter(([r, q]) => !st.room || r === st.room);
      return `<article class="group"><div class="ghead"><span class="row gap">${iconImg(i, 30)}<span><button class="linkbtn strong" data-item="${esc(i.id)}">${esc(i.name)}${i.size ? ' · ' + esc(i.size) : ''}</button> <span class="muted small">${esc(i.category || '')}${i.hazcards.length ? ' · Hazcard ' + esc(i.hazcards.join(', ')) : ''}</span></span></span>
        <span class="row gap small">Total <strong>${esc(totalStock(i))}</strong>${i.min !== '' ? ' · min ' + esc(i.min) : ''}<span class="pill ${sc}">${sl}</span></span></div>
        <table class="tbl rooms"><tbody>${rs.map(([r, q]) => `<tr><td>${esc(roomName(db, r))}</td><td><strong>${esc(q)}</strong></td>${st.where ? `<td class="muted">${esc(i.storage[r] || '')}</td>` : ''}
          <td class="right">${canEdit ? `<button class="qb" data-adj="-1" data-id="${esc(i.id)}" data-room="${esc(r)}" aria-label="Remove one from ${esc(roomName(db, r))}">−</button> <button class="qb" data-adj="1" data-id="${esc(i.id)}" data-room="${esc(r)}" aria-label="Add one to ${esc(roomName(db, r))}">+</button>` : ''}</td></tr>`).join('') || '<tr><td class="muted">Not in this room</td></tr>'}</tbody></table></article>`; }).join('') || '<p class="empty">Nothing matches.</p>'}</div>`}
    ${items.length > st.limit ? `<button class="btn" id="more">Show more (${items.length - st.limit} left)</button>` : ''}
  </div>`;

  const rr = () => render(el);
  $('#q').oninput = e => { st.q = e.target.value; st.limit = 60; const p = e.target.selectionStart; render(el).then(() => { const i = $('#q'); i.focus(); i.setSelectionRange(p, p); }); };
  $('#room').onchange = e => { st.room = e.target.value; rr(); };
  $('#where').onchange = e => { st.where = e.target.checked; rr(); };
  el.querySelectorAll('[data-list]').forEach(b => b.onclick = () => { st.list = b.dataset.list; st.q = ''; st.limit = 60; rr(); });
  el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { st.view = b.dataset.view; rr(); });
  el.querySelectorAll('[data-flag]').forEach(b => b.onclick = () => { st.flag = st.flag === b.dataset.flag ? '' : b.dataset.flag; rr(); });
  const more = $('#more'); if (more) more.onclick = () => { st.limit += 120; rr(); };
  $('#exp').onclick = () => download('inventory-' + (st.q ? 'search' : st.list) + '.csv', toCSV(items.map(i => ({ ...i, total: totalStock(i) }))), 'text/csv');
  el.querySelectorAll('[data-adj]').forEach(b => b.onclick = async () => {
    const v = await promptBox((b.dataset.adj > 0 ? 'Add to ' : 'Remove from ') + roomName(db, b.dataset.room), [{ name: 'n', label: 'How many', type: 'number', value: 1 }, { name: 'reason', label: 'Reason', options: REASONS, value: b.dataset.adj > 0 ? 'New stock arrived' : 'Broken' }]);
    if (!v) return; try { await call('adjustStock', { itemId: b.dataset.id, room: b.dataset.room, change: Number(b.dataset.adj) * Math.abs(Number(v.n) || 1), reason: v.reason }); toast('Saved'); await reload(); } catch (e) { toast(e.message, 'bad'); }
  });
  el.querySelectorAll('[data-item]').forEach(b => b.onclick = () => itemModal(db.inventory.find(i => i.id === b.dataset.item), canEdit));
  const add = $('#add'); if (add) add.onclick = () => itemModal({ list: st.list, rooms: {}, storage: {}, hazcards: [] }, true, true);
  const log = $('#log'); if (log) log.onclick = () => modal(`<div class="row between"><h2 class="h2">Recent changes</h2><button class="icon-btn" data-close aria-label="Close">×</button></div>
    <div class="scroll" style="max-height:60vh"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Item</th><th>Room</th><th>Change</th><th>Reason</th></tr></thead><tbody>${db.log.slice().reverse().map(l => `<tr><td class="small">${esc(new Date(l.at).toLocaleString('en-GB'))}</td><td>${esc(l.by)}</td><td>${esc(l.item)}</td><td>${esc(roomName(db, l.room))}</td><td>${l.change > 0 ? '+' : ''}${esc(l.change)}</td><td>${esc(l.reason)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No changes yet.</td></tr>'}</tbody></table></div>`, { wide: true });
}

function itemModal(i, canEdit, isNew) {
  const rooms = db.labs.filter(l => l.type !== 'classroom');
  if (!canEdit) {
    modal(`<div class="row between"><h2 class="h2">${esc(i.name)}${i.size ? ' · ' + esc(i.size) : ''}</h2><button class="icon-btn" data-close aria-label="Close">×</button></div>
      <div class="row gap">${iconImg(i, 64)}<dl class="dl"><dt>List</dt><dd>${esc(i.list)} · ${esc(i.category || '')}</dd><dt>Total</dt><dd>${esc(totalStock(i))}</dd>
      <dt>Where</dt><dd>${Object.entries(i.rooms).map(([r, q]) => `${esc(roomName(db, r))} (${esc(q)})${i.storage[r] ? ' › ' + esc(i.storage[r]) : ''}`).join('<br>')}</dd>${i.hazcards.length ? `<dt>Hazcards</dt><dd>${esc(i.hazcards.join(', '))}</dd>` : ''}</dl></div>`);
    return;
  }
  const d = modal(`<div class="row between"><h2 class="h2">${isNew ? 'Add item' : 'Edit item'}</h2><button class="icon-btn" data-close aria-label="Close">×</button></div>
    <form id="itf" class="stack"><div class="grid2">
      <label class="fld">Name<input name="name" value="${esc(i.name || '')}" required></label><label class="fld">Size<input name="size" value="${esc(i.size || '')}"></label>
      <label class="fld">List<select name="list">${LISTS.map(l => `<option${l === i.list ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label><label class="fld">Category<input name="category" value="${esc(i.category || '')}"></label>
      <label class="fld">Minimum (all rooms)<input name="min" type="number" value="${esc(i.min ?? '')}"></label><label class="fld">Hazcards (e.g. 91A, 47A)<input name="hazcards" value="${esc((i.hazcards || []).join(', '))}"></label>
      <label class="fld">Supplier<input name="supplier" value="${esc(i.supplier || '')}"></label><label class="fld">Reference<input name="ref" value="${esc(i.ref || '')}"></label>
      <label class="fld">Photo link (https://…)<input name="photo" value="${esc(i.photo || '')}"></label><label class="fld">Shelf-life / expiry<input name="shelfLife" value="${esc(i.shelfLife || '')}"></label></div>
      <label class="check"><input type="checkbox" name="orderRequired" ${i.orderRequired === true || i.orderRequired === 'TRUE' ? 'checked' : ''}> Order required</label>
      <h3 class="h3">Where it is</h3><table class="tbl"><thead><tr><th>Room</th><th>Quantity</th><th>Cabinet / position</th></tr></thead><tbody>
      ${rooms.map(r => `<tr><td>${esc(r.name)}</td><td><input class="num" type="number" min="0" name="q_${esc(r.room)}" value="${esc(i.rooms[r.room] ?? '')}" aria-label="Quantity in ${esc(r.name)}"></td><td><input name="p_${esc(r.room)}" value="${esc(i.storage[r.room] || '')}" aria-label="Position in ${esc(r.name)}"></td></tr>`).join('')}</tbody></table>
      <div class="row between">${isNew ? '<span></span>' : '<button type="button" class="btn danger-outline" id="del">Remove item</button>'}<div class="row gap"><button type="button" class="btn" data-close>Cancel</button><button class="btn pri">Save</button></div></div></form>`, { wide: true });
  d.querySelector('#itf').onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const r = {}, s = {};
    rooms.forEach(x => { const q = f['q_' + x.room]; if (q !== '' && q !== undefined) { r[x.room] = Number(q); s[x.room] = f['p_' + x.room] || ''; } });
    const row = { ...i, name: f.name, size: f.size, list: f.list, category: f.category, min: f.min === '' ? '' : Number(f.min), supplier: f.supplier, ref: f.ref, photo: f.photo, shelfLife: f.shelfLife,
      orderRequired: !!f.orderRequired, hazcards: f.hazcards.split(',').map(x => x.trim().toUpperCase()).filter(Boolean), rooms: r, storage: s };
    try { await call('upsert', { table: 'Inventory', row }); closeModal(); toast('Saved'); await reload(); } catch (err) { toast(err.message, 'bad'); }
  };
  const del = d.querySelector('#del'); if (del) del.onclick = async () => { if (await confirmBox('Remove “' + i.name + '” from the inventory?', 'Remove')) { await call('remove', { table: 'Inventory', key: i.id }); closeModal(); toast('Removed'); reload(); } };
}
