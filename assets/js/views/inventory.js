import { db, session, call } from '../store.js';
import { esc, totalStock, roomName, toCSV, iso, monday, addDays, clashes, nice, ACTIVE, safetyGap, SAFETY_GAP, sdsToCheck, hazcardsFor } from '../logic.js';
import { $, modal, closeModal, toast, promptBox, confirmBox, iconImg, download, safetyLinks, hazcardModal } from '../ui.js';
import { reload, setPane } from '../app.js';

const st = { list: 'Equipment', q: '', room: '', low: false, order: false, week: false, check: false, safety: false, view: 'list', where: true, limit: 150, sel: null, selRoom: null, sort: 'name', dir: 1 };
const LISTS = ['Equipment', 'Chemicals', 'Consumables', 'Microscope slides', 'Temporary', 'Stationery', 'Models', 'Documents'];
const REASONS = ['Broken', 'Lost', 'Used up', 'New stock arrived', 'Stocktake correction', 'Moved to another room'];
const isOrder = i => i.orderRequired === true || i.orderRequired === 'TRUE';
const below = i => Number(i.min) > 0 && totalStock(i) < Number(i.min);
const toCheck = i => /check/i.test(i.shelfLife || '');
const roomDigits = r => (String(r).match(/\d+\.\d+/) || [''])[0];

export async function render(el, _rest, params) {
  const canEdit = session.me.role !== 'teacher';
  if (params && params.get('flag') === 'low' && !st._fromLink) { st.low = true; st._fromLink = true; }
  const m = monday(new Date()), from = iso(m), to = iso(addDays(m, 4));
  const weekReqs = db.requests.filter(r => r.date >= from && r.date <= to && ACTIVE.includes(r.status));
  const bookedIds = new Set(weekReqs.flatMap(r => r.kit.map(k => k.itemId)));
  const weekClashes = weekReqs.filter(r => r.status !== 'done').map(r => ({ r, c: clashes(db, r) })).filter(x => x.c.length);

  let scope = st.q ? (() => { const w = st.q.toLowerCase().split(/\s+/); return db.inventory.filter(i => w.every(x => (i.name + ' ' + i.size + ' ' + i.category + ' ' + i.supplier + ' ' + i.ref + ' ' + (i.altNames || '')).toLowerCase().includes(x))); })()
    : db.inventory.filter(i => i.list === st.list);
  if (st.low) scope = scope.filter(below);
  if (st.safety) scope = db.inventory.filter(i => safetyGap(i) || sdsToCheck(i));
  if (st.order) scope = scope.filter(isOrder);
  if (st.week) scope = scope.filter(i => bookedIds.has(i.id));
  if (st.check) scope = scope.filter(toCheck);
  const rooms = db.labs.filter(l => l.type !== 'classroom');
  const roomCount = r => scope.filter(i => Number(i.rooms[r]) > 0).length;
  const statusOf = i => isOrder(i) ? ['Order required', 'urgent', 0] : below(i) ? ['Below minimum', 'warn', 1] : ['OK', 'ok', 2];
  const SORTS = {
    name: (a, b) => a.name.localeCompare(b.name) || String(a.size).localeCompare(String(b.size), undefined, { numeric: true }),
    size: (a, b) => String(a.size || '').localeCompare(String(b.size || ''), undefined, { numeric: true }),
    category: (a, b) => String(a.category || '').localeCompare(String(b.category || '')),
    list: (a, b) => String(a.list || '').localeCompare(String(b.list || '')),
    total: (a, b) => totalStock(a) - totalStock(b),
    here: (a, b) => (Number(a.rooms[st.room]) || 0) - (Number(b.rooms[st.room]) || 0),
    min: (a, b) => (Number(a.min) || 0) - (Number(b.min) || 0),
    status: (a, b) => statusOf(a)[2] - statusOf(b)[2],
    supplier: (a, b) => String(a.supplier || '').localeCompare(String(b.supplier || ''))
  };
  const sortFn = SORTS[st.sort] || SORTS.name;
  const items = (st.room ? scope.filter(i => Number(i.rooms[st.room]) > 0) : scope)
    .sort((a, b) => st.dir * sortFn(a, b) || SORTS.name(a, b));
  const shown = items.slice(0, st.limit);
  const roomsUsed = new Set(items.flatMap(i => Object.keys(i.rooms).filter(r => Number(i.rooms[r]) > 0)));
  const sel = db.inventory.find(i => i.id === st.sel);
  const orderBy = l => db.inventory.filter(i => isOrder(i) && i.list === l).length;
  const firstClash = weekClashes[0];
  const mixed = !!(st.q || st.safety); // results from several lists: show the list as a column
  const roomsOf = i => Object.entries(i.rooms).filter(([r, q]) => (st.room ? r === st.room : true) && (Number(q) > 0 || st.room === r || !Object.values(i.rooms).some(v => Number(v) > 0)));
  const posCell = (i, r) => { const pos = i.storage[r] || ''; const bad = pos && /^\d+\.\d+/.test(pos) && roomDigits(r) && !pos.startsWith(roomDigits(r));
    return `${esc(pos) || '<span class="muted">—</span>'}${bad ? ` <span class="warn-t" title="Position says ${esc(pos.match(/^\d+\.\d+/)[0])} — please check">!</span>` : ''}`; };
  const th = (k, label, cls = '') => `<th class="${cls}"><button data-sort="${k}" aria-label="Sort by ${esc(label)}">${esc(label)}${st.sort === k ? `<span class="arr">${st.dir > 0 ? '▲' : '▼'}</span>` : ''}</button></th>`;
  const safetyCell = i => `${i.hazcards.length ? `<span class="pill danger" title="CLEAPSS Hazcard">${esc(i.hazcards.join(', '))}</span> ` : ''}${i.sds ? `<a class="pill sds-pill" href="${esc(i.sds)}" target="_blank" rel="noopener">SDS</a>` : ''}${safetyGap(i) === 'none' ? '<span class="bad-t small">none</span>' : ''}`;
  const anySafety = shown.some(i => i.hazcards.length || i.sds || safetyGap(i));
  const anySupplier = shown.some(i => i.supplier || i.ref);
  const anySize = shown.some(i => i.size);

  const row = (i, n) => { const [sl, sc] = statusOf(i); const rs = roomsOf(i);
    return `<tr data-row="${esc(i.id)}" class="${st.sel === i.id ? 'on' : ''}">
      <td class="c-n">${n}</td>
      <td class="c-item"><span class="itemcell">${iconImg(i, 20)}<span><span class="nm">${esc(i.name)}</span>${i.altNames ? ` <span class="alt">· ${esc(i.altNames.split(/\s*[;|]\s*/).join(', '))}</span>` : ''}</span></span></td>
      ${anySize ? `<td>${esc(i.size || '')}</td>` : ''}
      ${mixed ? `<td>${esc(i.list || '')}</td>` : ''}
      <td>${esc(i.category || '')}</td>
      <td><span class="lines">${rs.map(([r, q]) => `<span><span class="q">${esc(q)}</span> ${esc(roomName(db, r))}</span>`).join('') || '<span class="muted">—</span>'}</span></td>
      ${st.where ? `<td><span class="lines">${rs.map(([r]) => `<span>${posCell(i, r)}</span>`).join('')}</span></td>` : ''}
      ${canEdit ? `<td class="no-row"><span class="lines">${rs.map(([r]) => `<span><button class="qb" data-adj="-1" data-id="${esc(i.id)}" data-room="${esc(r)}" aria-label="Remove one from ${esc(roomName(db, r))}">−</button><button class="qb" data-adj="1" data-id="${esc(i.id)}" data-room="${esc(r)}" aria-label="Add one to ${esc(roomName(db, r))}">+</button></span>`).join('')}</span></td>` : ''}
      <td class="c-num c-tot">${esc(totalStock(i))}</td>
      <td class="c-num">${i.min !== '' && i.min !== null && i.min !== undefined ? esc(i.min) : '<span class="muted">—</span>'}</td>
      <td><span class="pill ${sc}">${sl}</span></td>
      ${anySafety ? `<td>${safetyCell(i)}</td>` : ''}
      ${anySupplier ? `<td>${esc(i.supplier || '')}${i.ref ? ` <span class="muted">${esc(i.ref)}</span>` : ''}</td>` : ''}
    </tr>`; };

  el.innerHTML = `<div class="page wide">
    <header class="page-head"><div><h1 class="h1">Inventory</h1><p class="lede">${db.inventory.length.toLocaleString('en-GB')} records in ${LISTS.length} lists. Bookings are checked against these numbers.${canEdit ? '' : ' <strong>View only</strong> — tell the technicians if something is wrong or missing.'}</p></div>
      <div class="row gap wrap">${canEdit ? '<button class="btn pri" id="add">+ Add item</button>' : ''}<button class="btn" id="exp">Export CSV</button><button class="btn" id="safetyRep" title="Every chemical with its hazcard and SDS — for a health and safety check">Safety report</button>${canEdit ? '<button class="btn" id="log">Change log</button>' : ''}</div></header>
    <div class="stats">
      <button class="stat${st.low ? ' on' : ''}" data-flag="low" title="Across all lists"><span>below minimum</span><strong class="amber">${db.inventory.filter(below).length}</strong></button>
      <button class="stat${st.order ? ' on' : ''}" data-flag="order" title="${orderBy('Equipment')} equipment · ${orderBy('Consumables')} consumables"><span>order required</span><strong class="red">${db.inventory.filter(isOrder).length}</strong></button>
      <button class="stat${st.safety ? ' on' : ''}" data-flag="safety" title="${db.inventory.filter(i => safetyGap(i) === 'none').length} with neither hazcard nor SDS${db.inventory.some(sdsToCheck) ? ` · ${db.inventory.filter(sdsToCheck).length} SDS to check` : ''}"><span>missing safety info</span><strong class="red">${db.inventory.filter(i => safetyGap(i)).length}</strong></button>
      <button class="stat${st.check ? ' on' : ''}" data-flag="check" title="Shelf-life says “Check”"><span>chemicals to check</span><strong>${db.inventory.filter(toCheck).length}</strong></button>
      <a class="stat" href="#/week" title="${firstClash ? esc(firstClash.c[0].item.name) + ' · ' + esc(nice(firstClash.r.date)) + ' ' + esc(firstClash.r.start) : 'No clashes'}"><span>clashes this week</span><strong class="${weekClashes.length ? 'red' : ''}">${weekClashes.length}</strong></a>
    </div>
    <div class="tabs" role="tablist">${LISTS.map(l => `<button role="tab" aria-selected="${!st.q && st.list === l}" data-list="${esc(l)}">${esc(l)} <span class="muted">${db.inventory.filter(i => i.list === l).length}</span></button>`).join('')}</div>
    <div class="inv">
      <aside class="card inv-filter pane-l" aria-label="Filters">
        <div class="kicker">Room</div>
        <div class="roomlist"><button data-room="" aria-pressed="${!st.room}"><span>All rooms</span><span>${scope.length}</span></button>
          ${rooms.map(r => [r, roomCount(r.room)]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).map(([r, n]) => `<button data-room="${esc(r.room)}" aria-pressed="${st.room === r.room}"><span>${esc(r.name)}</span><span>${n}</span></button>`).join('')}</div>
        <div class="kicker">Show only</div>
        <div class="stack" style="gap:6px">
          <label class="check"><input type="checkbox" data-only="low" ${st.low ? 'checked' : ''}> Below minimum</label>
          <label class="check"><input type="checkbox" data-only="order" ${st.order ? 'checked' : ''}> Order required</label>
          <label class="check"><input type="checkbox" data-only="week" ${st.week ? 'checked' : ''}> Booked this week</label>
        </div>
      </aside>
      <section class="card inv-list">
        <div class="inv-tools">
          <input id="q" type="search" placeholder="Search name, size, supplier, ref…" value="${esc(st.q)}" aria-label="Search the inventory">
          <span class="count">${st.safety ? 'Missing hazcard / SDS · ' : st.q ? '' : esc(st.list) + ' · '}<strong>${items.length}</strong> item${items.length === 1 ? '' : 's'} in ${roomsUsed.size} room${roomsUsed.size === 1 ? '' : 's'}${st.room ? ' · ' + esc(roomName(db, st.room)) + ` <button class="linkbtn" data-room="">clear</button>` : ''}</span>
          <span class="grow"></span>
          <label class="switch"><input type="checkbox" id="where" ${st.where ? 'checked' : ''}><span>Cabinet</span></label>
          <div class="seg" role="group" aria-label="View"><button data-view="list" aria-pressed="${st.view === 'list'}">Table</button><button data-view="pics" aria-pressed="${st.view === 'pics'}">Pictures</button></div>
        </div>
        ${st.view === 'pics' ? `<div class="grid-pics">${shown.map(i => `<button class="pic" data-item="${esc(i.id)}"><span class="pimg${i.icon || i.photo ? '' : ' none'}">${i.icon || i.photo ? iconImg(i, 56) : 'No picture yet'}</span><strong>${esc(i.name)}${i.size ? ' · ' + esc(i.size) : ''}</strong><span class="muted xs">${esc(totalStock(i))} · ${Object.keys(i.rooms).filter(r => Number(i.rooms[r]) > 0).map(r => esc(roomName(db, r))).join(', ')}</span></button>`).join('')}</div>`
        : `<div class="sheet-wrap"><table class="grid"><thead><tr><th class="c-n">#</th>${th('name', 'Item', 'c-item')}${anySize ? th('size', 'Size') : ''}${mixed ? th('list', 'List') : ''}${th('category', 'Category')}${st.room ? th('here', 'Qty · Room') : '<th>Qty · Room</th>'}${st.where ? '<th>Cabinet</th>' : ''}${canEdit ? '<th>Adjust</th>' : ''}${th('total', 'Total', 'c-num')}${th('min', 'Min', 'c-num')}${th('status', 'Status')}${anySafety ? '<th>Safety</th>' : ''}${anySupplier ? th('supplier', 'Supplier · Ref') : ''}</tr></thead>
          <tbody>${shown.map((i, n) => row(i, n + 1)).join('') || `<tr><td colspan="12" class="empty">Nothing matches.</td></tr>`}</tbody></table></div>`}
        <div class="inv-foot"><span>Showing ${shown.length} of ${items.length}</span>${items.length > st.limit ? '<button class="btn small" id="more">Show more</button>' : ''}</div>
      </section>
      <aside class="card inv-edit pane-r${sel ? ' open' : ''}" id="edit" aria-label="Item details">${sel ? (canEdit ? editPanel(sel) : viewPanel(sel)) : ''}</aside>
    </div>
  </div>`;

  const rr = () => render(el, _rest, params);
  $('#q').oninput = e => { st.q = e.target.value; st.limit = 150; const p = e.target.selectionStart; render(el, _rest, params).then(() => { const i = $('#q'); i.focus(); i.setSelectionRange(p, p); }); };
  $('#where').onchange = e => { st.where = e.target.checked; rr(); };
  el.querySelectorAll('[data-room]').forEach(b => b.onclick = () => { st.room = b.dataset.room; rr(); });
  el.querySelectorAll('[data-only]').forEach(b => b.onchange = () => { st[b.dataset.only] = b.checked; rr(); });
  el.querySelectorAll('[data-list]').forEach(b => b.onclick = () => { st.list = b.dataset.list; st.q = ''; st.room = ''; st.limit = 150; rr(); });
  el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { st.view = b.dataset.view; rr(); });
  el.querySelectorAll('[data-flag]').forEach(b => b.onclick = () => { const f = b.dataset.flag; st[f] = !st[f]; rr(); });
  const more = $('#more'); if (more) more.onclick = () => { st.limit += 300; rr(); };
  el.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { const k = b.dataset.sort; if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = ['total', 'here', 'min'].includes(k) ? -1 : 1; } rr(); });
  const pick = (id, r) => { const i = db.inventory.find(x => x.id === id); if (!i) return; st.sel = i.id;
    st.selRoom = r || (st.room && i.rooms[st.room] !== undefined ? st.room : Object.keys(i.rooms)[0] || ''); setPane('r', true); rr(); };
  el.querySelectorAll('[data-row]').forEach(tr => tr.onclick = e => { if (e.target.closest('button, a, input')) return; pick(tr.dataset.row); });
  $('#safetyRep').onclick = () => download('safety-report-' + iso(new Date()) + '.csv', toCSV(db.inventory.filter(i => i.list === 'Chemicals').sort((a, b) => a.name.localeCompare(b.name)).map(i => ({
    chemical: i.name, size: i.size || '', hazcards: (i.hazcards || []).join(' '), sds: i.sds ? 'yes' : 'no', status: SAFETY_GAP[safetyGap(i)] || 'Hazcard and SDS',
    'SDS to check': sdsToCheck(i) ? i.sdsNote.replace(/^Close match — check it is the right one: /, '') : '', 'SDS link': i.sds || '', rooms: Object.keys(i.rooms || {}).join(' ') }))), 'text/csv');
  wireSafety(el);
  $('#exp').onclick = () => download('inventory-' + (st.q ? 'search' : st.list) + '.csv', toCSV(items.map(i => ({ ...i, total: totalStock(i) }))), 'text/csv');
  el.querySelectorAll('[data-adj]').forEach(b => b.onclick = async e => { e.stopPropagation();
    const v = await promptBox((b.dataset.adj > 0 ? 'Add to ' : 'Remove from ') + roomName(db, b.dataset.room), [{ name: 'n', label: 'How many', type: 'number', value: 1 }, { name: 'reason', label: 'Reason', options: REASONS, value: b.dataset.adj > 0 ? 'New stock arrived' : 'Broken' }]);
    if (!v) return; try { await call('adjustStock', { itemId: b.dataset.id, room: b.dataset.room, change: Number(b.dataset.adj) * Math.abs(Number(v.n) || 1), reason: v.reason }); toast('Saved'); await reload(); } catch (e) { toast(e.message, 'bad'); }
  });
  el.querySelectorAll('[data-item]').forEach(b => b.onclick = () => pick(b.dataset.item, b.dataset.r));
  const add = $('#add'); if (add) add.onclick = () => itemModal({ list: st.list, rooms: {}, storage: {}, hazcards: [] }, true);
  const log = $('#log'); if (log) log.onclick = () => modal(`<div class="row between"><h2 class="h2">Recent changes</h2><button class="icon-btn" data-close aria-label="Close">×</button></div>
    <div class="scroll" style="max-height:60vh"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>Item</th><th>Room</th><th>Change</th><th>Reason</th></tr></thead><tbody>${db.log.slice().reverse().map(l => `<tr><td class="small">${esc(new Date(l.at).toLocaleString('en-GB'))}</td><td>${esc(l.by)}</td><td>${esc(l.item)}</td><td>${esc(roomName(db, l.room))}</td><td>${l.change > 0 ? '+' : ''}${esc(l.change)}</td><td>${esc(l.reason)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No changes yet.</td></tr>'}</tbody></table></div>`, { wide: true });
  if (sel && canEdit) wireEdit(el, sel);
  const cl = $('#closeEdit'); if (cl) cl.onclick = () => { st.sel = null; rr(); };
}

function history(i) {
  const h = db.log.filter(l => l.itemId === i.id).slice().reverse().slice(0, 6);
  return `<div class="kicker">History</div>${h.length ? `<ul class="histlist">${h.map(l => `<li>${l.change > 0 ? '+' : '−'}${Math.abs(l.change)} ${esc(String(l.reason || '').toLowerCase())} · ${esc(roomName(db, l.room))} · [${esc(l.by)}] · ${esc(new Date(l.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</li>`).join('')}</ul>` : '<p class="muted xs">No changes recorded yet.</p>'}`;
}

/** Hazcards and SDS for a chemical (or any item that has a hazcard). */
function safetyBlock(i, staff) {
  if (i.list !== 'Chemicals' && !(i.hazcards || []).length && !i.sds) return '';
  return `<div class="safety-block"><div class="kicker">Safety</div>${safetyLinks(i, staff)}</div>`;
}
function wireSafety(root) {
  root.querySelectorAll('[data-hz]').forEach(b => b.onclick = () => { const cards = hazcardsFor(db, [{ itemId: st.sel }]); const k = cards.findIndex(c => c.code === b.dataset.hz);
    hazcardModal(cards.slice(k).concat(cards.slice(0, k)), 'Hazcard', 'Close'); });
  root.querySelectorAll('[data-sds-ok]').forEach(b => b.onclick = async () => { const it = db.inventory.find(x => x.id === b.dataset.sdsOk);
    try { await call('upsert', { table: 'Inventory', row: { ...it, sdsNote: '' } }); toast('SDS confirmed'); await reload(); } catch (e) { toast(e.message, 'bad'); } });
}

function viewPanel(i) {
  return `<div class="row between"><div class="kicker" style="margin:0">Item</div><button class="icon-btn" id="closeEdit" aria-label="Close">×</button></div>
    <h2 class="h2" style="margin:2px 0 8px">${esc(i.name)}${i.size ? ' ' + esc(i.size) : ''}</h2>
    <div class="row gap" style="align-items:flex-start">${iconImg(i, 56)}<dl class="dl" style="margin:0"><dt>List</dt><dd>${esc(i.list)} · ${esc(i.category || '')}</dd><dt>Total</dt><dd>${esc(totalStock(i))}</dd>
    <dt>Where</dt><dd>${Object.entries(i.rooms).map(([r, q]) => `${esc(roomName(db, r))} (${esc(q)})${i.storage[r] ? ' › ' + esc(i.storage[r]) : ''}`).join('<br>')}</dd></dl></div>
    ${safetyBlock(i, false)}`;
}

function editPanel(i) {
  const r = st.selRoom; const rooms = db.labs.filter(l => l.type !== 'classroom');
  const building = (db.labs.find(l => l.room === r) || {}).building || '';
  const buildings = [...new Set(db.labs.map(l => l.building).filter(Boolean))];
  return `<form id="ef" class="stack" style="gap:8px">
    <div class="row between"><div class="kicker" style="margin:0">Edit item</div><button type="button" class="icon-btn" id="closeEdit" aria-label="Close">×</button></div>
    <h2 class="h2">${esc(i.name)}${i.size ? ' ' + esc(i.size) : ''}${r ? ' · ' + esc(roomName(db, r)) : ''}</h2>
    <div class="row gap"><button class="btn pri grow">Save</button><button type="button" class="btn" id="moreItem">All details…</button><button type="button" class="btn danger-outline" id="delItem">Remove</button></div>
    <div class="grid2" style="grid-template-columns:1fr 1fr">
      <label class="fld">Quantity<input name="qty" type="number" min="0" value="${esc(r ? (i.rooms[r] ?? 0) : '')}" ${r ? '' : 'disabled'}></label>
      <label class="fld">Minimum<input name="min" type="number" min="0" value="${esc(i.min ?? '')}" placeholder="all rooms"></label>
      <label class="fld">Room<select name="room">${rooms.map(x => `<option value="${esc(x.room)}"${x.room === r ? ' selected' : ''}>${esc(x.name)}${i.rooms[x.room] !== undefined ? '' : ' (new)'}</option>`).join('')}</select></label>
      <label class="fld">Cabinet<input name="pos" value="${esc(r ? i.storage[r] || '' : '')}"></label>
      <label class="fld">Building<select disabled>${buildings.map(b => `<option${b === building ? ' selected' : ''}>${esc(b)} building</option>`).join('')}</select></label>
      <label class="fld">List<select name="list">${LISTS.map(l => `<option${l === i.list ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="fld">Supplier<input name="supplier" value="${esc(i.supplier || '')}" placeholder="—"></label>
      <label class="fld">Reference<input name="ref" value="${esc(i.ref || '')}" placeholder="—"></label>
    </div>
    <label class="check"><input type="checkbox" name="orderRequired" ${isOrder(i) ? 'checked' : ''}> Order required</label>
    ${safetyBlock(i, true)}
    <label class="fld">Reason for change<select name="reason">${REASONS.map(x => `<option${x === 'Stocktake correction' ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
    <hr style="margin:4px 0">${history(i)}
  </form>`;
}

function wireEdit(el, i) {
  const f = $('#ef', el);
  f.room.onchange = () => { st.selRoom = f.room.value; render(el); };
  f.onsubmit = async e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(f)); const r = st.selRoom;
    try {
      const row = { ...i, rooms: { ...i.rooms }, storage: { ...i.storage }, min: v.min === '' ? '' : Number(v.min), list: v.list, supplier: v.supplier, ref: v.ref, orderRequired: !!v.orderRequired };
      if (r) { row.storage[r] = v.pos || ''; if (row.rooms[r] === undefined) row.rooms[r] = 0; }
      await call('upsert', { table: 'Inventory', row });
      const old = Number(i.rooms[r]) || 0, now = Number(v.qty);
      if (r && v.qty !== undefined && v.qty !== '' && now !== old) await call('adjustStock', { itemId: i.id, room: r, change: now - old, reason: v.reason });
      toast('Saved'); await reload();
    } catch (err) { toast(err.message, 'bad'); }
  };
  $('#delItem', el).onclick = async () => { if (await confirmBox('Remove “' + i.name + '” from the inventory?', 'Remove')) { await call('remove', { table: 'Inventory', key: i.id }); st.sel = null; toast('Removed'); reload(); } };
  $('#moreItem', el).onclick = () => itemModal(i, false);
}

function itemModal(i, isNew) {
  const rooms = db.labs.filter(l => l.type !== 'classroom');
  const d = modal(`<form id="itf" class="stack"><div class="row between"><h2 class="h2">${isNew ? 'Add item' : 'Edit item'}</h2><div class="row gap"><button type="button" class="btn" data-close>Cancel</button><button class="btn pri">Save</button></div></div>
    <div class="grid2">
      <label class="fld">Name<input name="name" value="${esc(i.name || '')}" required></label><label class="fld">Size<input name="size" value="${esc(i.size || '')}"></label>
      <label class="fld">List<select name="list">${LISTS.map(l => `<option${l === i.list ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label><label class="fld">Category<input name="category" value="${esc(i.category || '')}"></label>
      <label class="fld">Minimum (all rooms)<input name="min" type="number" value="${esc(i.min ?? '')}"></label><label class="fld">Hazcards (e.g. 91A, 47A)<input name="hazcards" value="${esc((i.hazcards || []).join(', '))}"></label>
      <label class="fld">Supplier<input name="supplier" value="${esc(i.supplier || '')}"></label><label class="fld">Reference<input name="ref" value="${esc(i.ref || '')}"></label>
      <label class="fld">Photo link (https://…)<input name="photo" value="${esc(i.photo || '')}"></label><label class="fld">Shelf-life / expiry<input name="shelfLife" value="${esc(i.shelfLife || '')}"></label>
      <label class="fld">Safety data sheet link (SDS)<input name="sds" value="${esc(i.sds || '')}" placeholder="filled in by linkSds, or paste a link"></label>
      <label class="fld">Other names (separate with ;)<input name="altNames" value="${esc(i.altNames || '')}" placeholder="e.g. diastase; amylase"></label></div>
      <label class="check"><input type="checkbox" name="orderRequired" ${isOrder(i) ? 'checked' : ''}> Order required</label>
      <h3 class="h3">Where it is</h3><table class="tbl"><thead><tr><th>Room</th><th>Quantity</th><th>Cabinet / position</th></tr></thead><tbody>
      ${rooms.map(r => `<tr><td>${esc(r.name)}</td><td><input class="num" type="number" min="0" name="q_${esc(r.room)}" value="${esc(i.rooms[r.room] ?? '')}" aria-label="Quantity in ${esc(r.name)}"></td><td><input name="p_${esc(r.room)}" value="${esc(i.storage[r.room] || '')}" aria-label="Position in ${esc(r.name)}"></td></tr>`).join('')}</tbody></table></form>`, { wide: true });
  d.querySelector('#itf').onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const r = {}, s = {};
    rooms.forEach(x => { const q = f['q_' + x.room]; if (q !== '' && q !== undefined) { r[x.room] = Number(q); s[x.room] = f['p_' + x.room] || ''; } });
    const row = { ...i, name: f.name, size: f.size, list: f.list, category: f.category, min: f.min === '' ? '' : Number(f.min), supplier: f.supplier, ref: f.ref, photo: f.photo, shelfLife: f.shelfLife, sds: f.sds.trim(), sdsNote: f.sds.trim() === (i.sds || '') ? (i.sdsNote || '') : '', altNames: f.altNames.trim(),
      orderRequired: !!f.orderRequired, hazcards: f.hazcards.split(',').map(x => x.trim().toUpperCase()).filter(Boolean), rooms: r, storage: s };
    try { const saved = await call('upsert', { table: 'Inventory', row }); closeModal(); toast('Saved'); if (saved && saved.id) { st.sel = saved.id; st.selRoom = Object.keys(r)[0] || null; } await reload(); } catch (err) { toast(err.message, 'bad'); }
  };
}
