import { db, call, TABLES, isDemo } from '../store.js';
import { esc, iso, monday, addDays, ACTIVE, clashes, totalStock, toCSV, fromCSV, nice } from '../logic.js';
import { $, modal, closeModal, toast, confirmBox, download, statusChip } from '../ui.js';
import { reload } from '../app.js';

const JSON_COLS = ['rooms', 'storage', 'hazcards', 'kit', 'history'];
const KEY = { Settings: 'settings', Users: 'users', Labs: 'labs', Timetable: 'timetable', Inventory: 'inventory', Hazcards: 'hazcards', Library: 'library', Requests: 'requests', InventoryLog: 'log' };
const st = { tab: 'overview' };

export async function render(el) {
  const tabs = [['overview', 'Overview'], ['people', 'People'], ['settings', 'Settings'], ['data', 'Import & export']];
  el.innerHTML = `<div class="page wide"><h1 class="h1">Head of department</h1>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${st.tab === k}" data-tab="${k}">${l}</button>`).join('')}</div><div id="pane"></div></div>`;
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; render(el); });
  ({ overview, people, settings, data })[st.tab]($('#pane', el), el);
}

function overview(p) {
  const m = monday(new Date()), from = iso(m), to = iso(addDays(m, 4));
  const week = db.requests.filter(r => r.date >= from && r.date <= to && ACTIVE.includes(r.status));
  const waiting = db.requests.filter(r => r.status === 'submitted' && r.date >= iso(new Date()));
  const late = db.requests.filter(r => r.late && r.date >= iso(new Date()) && ACTIVE.includes(r.status));
  const clash = db.requests.filter(r => r.date >= iso(new Date()) && ACTIVE.includes(r.status) && clashes(db, r).length);
  const low = db.inventory.filter(i => Number(i.min) > 0 && totalStock(i) < Number(i.min));
  const byT = {}; db.requests.filter(r => ACTIVE.includes(r.status)).forEach(r => byT[r.teacher] = (byT[r.teacher] || 0) + 1);
  const list = (rows, empty) => rows.length ? `<table class="tbl"><tbody>${rows.slice(0, 8).map(r => `<tr><td>${esc(nice(r.date))} ${esc(r.start)}</td><td>${esc(r.teacher)}</td><td>${esc(r.class)}</td><td>${esc(r.title)}</td><td>${statusChip(r.status)}</td><td><a href="#/prep/${esc(r.id)}">Open</a></td></tr>`).join('')}</tbody></table>` : `<p class="muted">${empty}</p>`;
  p.innerHTML = `<div class="stats">${[['Practicals this week', week.length], ['Waiting for technicians', waiting.length], ['Booked late', late.length], ['Equipment clashes', clash.length], ['Items below minimum', low.length]].map(([l, n]) => `<div class="stat"><span>${l}</span><strong>${n}</strong></div>`).join('')}</div>
    <div class="cols"><section class="card"><h2 class="h2">Booked late</h2>${list(late, 'None — everyone booked on time.')}</section>
    <section class="card"><h2 class="h2">Equipment clashes</h2>${list(clash, 'No clashes.')}</section></div>
    <div class="cols"><section class="card"><h2 class="h2">Practicals per teacher</h2><table class="tbl"><tbody>${Object.entries(byT).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<tr><td>${esc(t)}</td><td class="num">${n}</td></tr>`).join('') || '<tr><td class="muted">None yet</td></tr>'}</tbody></table></section>
    <section class="card"><h2 class="h2">Below minimum stock</h2><table class="tbl"><tbody>${low.slice(0, 12).map(i => `<tr><td>${esc(i.name)} ${esc(i.size || '')}</td><td class="num">${totalStock(i)} / ${esc(i.min)}</td></tr>`).join('') || '<tr><td class="muted">All stocked</td></tr>'}</tbody></table><a href="#/inventory">Open inventory</a></section></div>`;
}

function people(p, root) {
  const ROLES = [['teacher', 'Teacher'], ['technician', 'Lab technician'], ['admin', 'Admin (HOD)']];
  p.innerHTML = `<div class="row between"><p class="muted">Only people listed here (and active) can sign in. The name must match the timetable so their lessons appear.</p><button class="btn pri" id="addu">+ Add person</button></div>
    <table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th></th></tr></thead><tbody>
    ${db.users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email || '— add email —')}</td><td>${esc((ROLES.find(r => r[0] === u.role) || [, u.role])[1])}</td><td>${u.active === false || u.active === 'FALSE' ? 'No' : 'Yes'}</td><td class="right"><button class="linkbtn" data-u="${esc(u.email || u.name)}">Edit</button></td></tr>`).join('')}</tbody></table>`;
  const teachers = [...new Set(db.timetable.map(t => t.teacher))].sort();
  const edit = u => {
    const d = modal(`<div class="row between"><h2 class="h2">${u.name ? 'Edit person' : 'Add person'}</h2><button class="icon-btn" data-close aria-label="Close">×</button></div>
      <form id="uf" class="stack"><label class="fld">Name (as in timetable)<input name="name" list="tnames" value="${esc(u.name || '')}" required><datalist id="tnames">${teachers.map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
      <label class="fld">School Google email<input name="email" type="email" value="${esc(u.email || '')}" required></label>
      <label class="fld">Role<select name="role">${ROLES.map(([k, l]) => `<option value="${k}"${u.role === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="active" ${u.active === false || u.active === 'FALSE' ? '' : 'checked'}> Can sign in</label>
      <div class="row between">${u.name ? '<button type="button" class="btn danger-outline" id="delu">Remove</button>' : '<span></span>'}<div class="row gap"><button type="button" class="btn" data-close>Cancel</button><button class="btn pri">Save</button></div></div></form>`);
    d.querySelector('#uf').onsubmit = async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      const row = { email: f.email.trim().toLowerCase(), name: f.name.trim(), role: f.role, active: !!f.active };
      const others = db.users.filter(x => x !== u && x.email !== row.email);
      try {
        await call('importTable', { table: 'Users', rows: others.concat([row]), mode: 'replace' });
        closeModal(); toast('Saved'); await reload();
      } catch (err) { toast(err.message, 'bad'); }
    };
    const del = d.querySelector('#delu'); if (del) del.onclick = async () => { if (await confirmBox('Remove ' + u.name + '? They will no longer be able to sign in.', 'Remove')) { await call('importTable', { table: 'Users', rows: db.users.filter(x => x !== u), mode: 'replace' }); closeModal(); reload(); } };
  };
  $('#addu', p).onclick = () => edit({ role: 'teacher' });
  p.querySelectorAll('[data-u]').forEach(b => b.onclick = () => edit(db.users.find(u => (u.email || u.name) === b.dataset.u)));
}

function settings(p) {
  const s = db.settings;
  p.innerHTML = `<form id="sf" class="card stack" style="max-width:640px">
    <label class="fld">School name<input name="schoolName" value="${esc(s.schoolName || '')}"></label>
    <label class="fld">Working days technicians need before a practical<input name="leadDays" type="number" min="0" max="10" value="${esc(s.leadDays)}"></label>
    <p class="muted small">With 3: a Monday practical must be booked by the end of the Wednesday before. Weekends and the holidays below are skipped.</p>
    <div class="grid2"><label class="fld">Day starts<input name="dayStart" type="time" value="${esc(s.dayStart || '08:30')}"></label><label class="fld">Day ends<input name="dayEnd" type="time" value="${esc(s.dayEnd || '16:00')}"></label></div>
    <label class="fld">Holidays and non-working days (one date per line, YYYY-MM-DD)<textarea name="holidays" rows="6">${esc((s.holidays || []).join('\n'))}</textarea></label>
    <div class="row end"><button class="btn pri">Save settings</button></div></form>`;
  $('#sf', p).onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    const holidays = f.holidays.split(/[\s,]+/).map(x => x.trim()).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
    const row = { schoolName: f.schoolName, leadDays: Number(f.leadDays) || 3, dayStart: f.dayStart, dayEnd: f.dayEnd, holidays };
    try { await call('importTable', { table: 'Settings', rows: { ...db.settings, ...row }, mode: 'replace' }); toast('Settings saved'); await reload(); } catch (err) { toast(err.message, 'bad'); }
  };
}

function data(p) {
  const opts = TABLES.map(t => `<option>${t}</option>`).join('');
  p.innerHTML = `<div class="cols"><section class="card stack"><h2 class="h2">Export</h2><p class="muted">Download one table, or everything as a single backup file.</p>
      <label class="fld">Table<select id="et">${opts}</select></label>
      <div class="row gap wrap"><button class="btn" id="ejson">Download JSON</button><button class="btn" id="ecsv">Download CSV (opens in Excel)</button></div>
      <hr><button class="btn pri" id="eall">Download full backup</button></section>
    <section class="card stack"><h2 class="h2">Import</h2><p class="muted">Use the files in the <strong>school-data</strong> folder to load your real timetable, inventory and library, or a CSV saved from Excel.</p>
      <label class="fld">Table<select id="it">${opts}</select></label>
      <label class="fld">File (.json or .csv)<input type="file" id="if" accept=".json,.csv,application/json,text/csv"></label>
      <fieldset class="seg-radio"><legend class="small">How</legend><label><input type="radio" name="mode" value="replace" checked> Replace the table</label> <label><input type="radio" name="mode" value="append"> Add to the table</label></fieldset>
      <button class="btn pri" id="ido">Import</button>
      <hr><h3 class="h3">Restore a full backup</h3><input type="file" id="bf" accept=".json"><button class="btn danger-outline" id="bdo">Restore everything from backup</button></section></div>
    ${isDemo() ? '<p class="note">Demo mode: imports are kept in this browser only.</p>' : ''}`;
  const stamp = iso(new Date());
  const get = t => call('exportTable', { table: t });
  $('#ejson', p).onclick = async () => { const t = $('#et', p).value; download(`${t}-${stamp}.json`, JSON.stringify(await get(t), null, 2)); };
  $('#ecsv', p).onclick = async () => { const t = $('#et', p).value; let rows = await get(t); if (!Array.isArray(rows)) rows = Object.entries(rows).map(([key, value]) => ({ key, value })); download(`${t}-${stamp}.csv`, toCSV(rows), 'text/csv'); };
  $('#eall', p).onclick = async () => { const all = {}; for (const t of TABLES) all[t] = await get(t); download(`practicals-backup-${stamp}.json`, JSON.stringify(all, null, 2)); };
  $('#ido', p).onclick = async () => {
    const t = $('#it', p).value, file = $('#if', p).files[0], mode = p.querySelector('[name=mode]:checked').value;
    if (!file) return toast('Choose a file first', 'bad');
    let rows; const text = await file.text();
    try {
      if (/\.csv$/i.test(file.name)) {
        rows = fromCSV(text).map(r => { JSON_COLS.forEach(c => { if (typeof r[c] === 'string' && /^[\[{]/.test(r[c].trim())) { try { r[c] = JSON.parse(r[c]); } catch (e) {} } }); return r; });
        if (t === 'Settings') rows = Object.fromEntries(rows.map(r => [r.key, r.value]));
      } else { rows = JSON.parse(text); if (rows && !Array.isArray(rows) && rows[t]) rows = rows[t]; }
    } catch (e) { return toast('Could not read that file: ' + e.message, 'bad'); }
    const n = Array.isArray(rows) ? rows.length : Object.keys(rows).length;
    if (!(await confirmBox(`${mode === 'replace' ? 'Replace' : 'Add to'} ${t} with ${n} row${n === 1 ? '' : 's'} from ${file.name}?`, 'Import'))) return;
    try { await call('importTable', { table: t, rows, mode }); toast(`Imported ${n} into ${t}`); await reload(); } catch (e) { toast(e.message, 'bad'); }
  };
  $('#bdo', p).onclick = async () => {
    const file = $('#bf', p).files[0]; if (!file) return toast('Choose a backup file first', 'bad');
    let all; try { all = JSON.parse(await file.text()); } catch (e) { return toast('Not a valid backup file', 'bad'); }
    const ts = TABLES.filter(t => all[t] !== undefined);
    if (!ts.length) return toast('No tables found in that file', 'bad');
    if (!(await confirmBox(`Replace ${ts.join(', ')} with the backup? This overwrites current data.`, 'Restore'))) return;
    try { for (const t of ts) await call('importTable', { table: t, rows: all[t], mode: 'replace' }); toast('Backup restored'); await reload(); } catch (e) { toast(e.message, 'bad'); }
  };
}
