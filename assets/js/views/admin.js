import { db, call, TABLES, isDemo } from '../store.js';
import { CONFIG } from '../config.js';
import { esc, iso, monday, addDays, ACTIVE, DAYS, labRooms, totalStock, toCSV, fromCSV, nice } from '../logic.js';
import { $, modal, closeModal, toast, confirmBox, download } from '../ui.js';
import { reload } from '../app.js';

const JSON_COLS = ['rooms', 'storage', 'hazcards', 'kit', 'history', 'risks', 'activities', 'names', 'solutes', 'hazards', 'controls', 'emergency'];
const KEY = { Settings: 'settings', Users: 'users', Labs: 'labs', Timetable: 'timetable', Inventory: 'inventory', Hazcards: 'hazcards', Library: 'library', Requests: 'requests', InventoryLog: 'log', Recipes: 'recipes', RiskCards: 'riskcards' };
const PAGES = { overview: ['Department overview', overview], people: ['People & roles', people], settings: ['Rules & lead times', settings], data: ['Import & export', data] };

export async function render(el, [sub]) {
  const k = PAGES[sub] ? sub : 'overview';
  if (k === 'overview') { overview(el); return; }
  el.innerHTML = `<div class="page"><header class="page-head"><div><div class="eyebrow">Head of department</div><h1 class="h1">${PAGES[k][0]}</h1></div></header><div id="pane" class="stack"></div></div>`;
  PAGES[k][1]($('#pane', el), el);
}

const periodsPerDay = () => Number(db.settings.periodsPerDay) || 6;
const prepMin = r => Number(db.library.find(p => p.id === r.practicalId)?.prepMinutes) || 30;

function overview(el) {
  const today = iso(new Date()); const m = monday(new Date()), from = iso(m), to = iso(addDays(m, 4));
  const dates = [0, 1, 2, 3, 4].map(i => iso(addDays(m, i)));
  const week = db.requests.filter(r => r.date >= from && r.date <= to && ACTIVE.includes(r.status));
  const labsUsed = new Set(week.map(r => r.room));
  const due = week.filter(r => r.date <= today); const onTime = due.filter(r => ['ready', 'done'].includes(r.status));
  const queried = db.requests.filter(r => (r.query || r.reply) && r.date >= from); const openQ = queried.filter(r => r.query && !['done', 'rejected', 'cancelled'].includes(r.status));
  const urgent = db.requests.filter(r => r.late && r.date >= today && ['submitted', 'accepted', 'in_progress', 'ready'].includes(r.status));
  const lateAll = db.requests.filter(r => r.late && ACTIVE.includes(r.status));
  // approvals
  const appr = [];
  db.requests.filter(r => r.late && r.status === 'submitted' && !r.hodApproved && r.date >= today).forEach(r => appr.push({ kind: 'req', id: r.id, tag: ['Urgent', 'urgent'],
    title: `${r.title} · ${r.class} · ${r.date === iso(addDays(new Date(), 1)) ? 'tomorrow' : nice(r.date)} ${r.start}`, meta: `${r.teacher} · late request${r.notes ? ' · ' + r.notes : ''}` }));
  db.inventory.filter(i => (i.orderRequired === true || i.orderRequired === 'TRUE') && !i.orderApproved).slice(0, 4).forEach(i => appr.push({ kind: 'buy', id: i.id, tag: ['Purchase', 'purchase'],
    title: `${Math.max(1, (Number(i.min) || 0) - totalStock(i))} × ${i.name}${i.size ? ', ' + i.size : ''}`, meta: `Marked “order required” · ${i.list}${i.supplier ? ' · ' + i.supplier : ''}` }));
  // stock alerts
  const nextFrom = iso(addDays(m, 7)), nextTo = iso(addDays(m, 11));
  const nextWeek = db.requests.filter(r => r.date >= nextFrom && r.date <= nextTo && ACTIVE.includes(r.status));
  const low = db.inventory.filter(i => Number(i.min) > 0 && totalStock(i) < Number(i.min))
    .map(i => ({ i, n: new Set(nextWeek.filter(r => r.kit.some(k => k.itemId === i.id)).map(r => r.class)).size })).sort((a, b) => b.n - a.n).slice(0, 3);
  const check = db.inventory.filter(i => i.list === 'Chemicals' && /check|\d{4}-\d{2}-\d{2}/i.test(i.shelfLife || '') && totalStock(i) > 0).slice(0, 1);
  // prep load + lab heatmap
  const load = dates.map(d => week.filter(r => r.date === d && r.status !== 'done').reduce((s, r) => s + prepMin(r), 0) / 60);
  const maxLoad = Math.max(8, ...load);
  const labs = labRooms(db); const per = periodsPerDay();
  const heat = n => { const x = n / per; return x === 0 ? 'hm0' : x <= .34 ? 'hm1' : x <= .67 ? 'hm2' : 'hm3'; };
  const hrs = h => (Math.round(h * 2) / 2).toString().replace(/\.0$/, '') + ' h';

  el.innerHTML = `<div class="page">
    <header class="page-head"><div><div class="eyebrow">Week of ${esc(m.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }))}${db.settings.schoolName ? ' · ' + esc(db.settings.schoolName) : ''}</div><h1 class="h1">Department overview</h1></div>
      <button class="btn" id="report">Export term report</button></header>
    <section class="stats">
      <div class="stat"><span>Practicals this week</span><strong>${week.length}</strong><span class="sub">across ${labsUsed.size} lab${labsUsed.size === 1 ? '' : 's'}</span></div>
      <div class="stat"><span>Ready on time</span><strong>${onTime.length} / ${due.length}</strong><span class="sub">so far this week</span></div>
      <div class="stat"><span>Requests queried</span><strong>${queried.length}</strong><span class="sub">${openQ.length} still open</span></div>
      <div class="stat"><span>Urgent requests</span><strong>${urgent.length}</strong><span class="sub">booked late · ${lateAll.length} in total</span></div>
    </section>
    <div class="cols">
      <div class="main-col">
        <section class="card"><div class="card-head" style="margin-bottom:8px"><h2 class="h2">Waiting for you</h2><a href="#/requests" class="small">All requests</a></div>
          ${appr.length ? appr.slice(0, 6).map(a => `<div class="appr"><div><span class="pill ${a.tag[1]}">${a.tag[0]}</span><div class="t">${esc(a.title)}</div><div class="m">${esc(a.meta)}</div></div>
            <div class="row gap">${a.kind === 'req' ? `<a class="btn small" href="#/requests/${esc(a.id)}">Open</a>` : ''}<button class="btn small" data-decline="${a.kind}:${esc(a.id)}">Decline</button><button class="btn pri small" data-approve="${a.kind}:${esc(a.id)}">Approve</button></div></div>`).join('')
            : '<p class="muted">Nothing waiting — no late requests or purchases to approve.</p>'}
        </section>
        <section class="card"><h2 class="h2">Lab bookings this week</h2><p class="muted small" style="margin:4px 0 12px">Periods booked for practicals, out of ${per} per day</p>
          <div class="scroll"><table class="heat"><thead><tr><th>Lab</th>${DAYS.map(d => `<th>${d}</th>`).join('')}</tr></thead><tbody>
          ${labs.map(l => `<tr><td class="lab strong">${esc(l.name)}</td>${dates.map(d => { const n = week.filter(r => r.room === l.room && r.date === d).length; return `<td class="${heat(n)}" title="${esc(l.name)} ${esc(nice(d))}: ${n} of ${per}">${n}/${per}</td>`; }).join('')}</tr>`).join('')}
          </tbody></table></div></section>
      </div>
      <aside class="side-col" style="gap:24px">
        <section class="card"><h2 class="h2" style="margin-bottom:14px">Stock alerts</h2><div class="alerts">
          ${low.map(({ i, n }) => `<div><b>${esc(i.name)}${i.size ? ', ' + esc(i.size) : ''}</b><span>${totalStock(i)} left · min ${esc(i.min)}${n ? ` · needed by ${n} class${n > 1 ? 'es' : ''} next week` : ''}</span></div>`).join('')}
          ${check.map(i => `<div><b>${esc(i.name)}${i.size ? ' ' + esc(i.size) : ''}</b><span class="bad">Shelf-life: ${esc(i.shelfLife)}${i.hazcards.length ? ' · hazcard ' + esc(i.hazcards.join(', ')) : ''}</span></div>`).join('')}
          ${!low.length && !check.length ? '<p class="muted small">All stocked.</p>' : ''}
          <a href="#/inventory?flag=low" class="small">Open inventory</a></div></section>
        <section class="card"><h2 class="h2">Technician prep load</h2><p class="muted small" style="margin:4px 0 14px">Estimated hours, from the practical library</p>
          <div class="bars">${DAYS.map((d, i) => `<span>${d}</span><span class="bar"><i class="${load[i] > 6 ? 'hot' : ''}" style="width:${Math.round(load[i] / maxLoad * 100)}%"></i></span><span class="right strong">${hrs(load[i])}</span>`).join('')}</div></section>
      </aside>
    </div></div>`;

  el.querySelector('#report').onclick = () => download(`practicals-report-${today}.csv`, toCSV(db.requests.filter(r => r.status !== 'draft').map(r => ({ date: r.date, start: r.start, end: r.end, teacher: r.teacher, class: r.class, subject: r.subject, room: r.room, practical: r.title, sets: r.sets, status: r.status, late: r.late, rating: r.rating || '', feedback: r.feedback || '' }))), 'text/csv');
  const act = async (spec, ok) => {
    const [kind, id] = spec.split(':');
    try {
      if (kind === 'req') await call('updateRequest', { id, patch: ok ? { hodApproved: true } : { status: 'rejected', techNotes: 'Declined by the head of department' } });
      else { const i = db.inventory.find(x => x.id === id); await call('upsert', { table: 'Inventory', row: ok ? { ...i, orderApproved: true } : { ...i, orderRequired: false } }); }
      toast(ok ? 'Approved' : 'Declined'); await reload();
    } catch (e) { toast(e.message, 'bad'); }
  };
  el.querySelectorAll('[data-approve]').forEach(b => b.onclick = () => act(b.dataset.approve, true));
  el.querySelectorAll('[data-decline]').forEach(b => b.onclick = async () => { if (await confirmBox('Decline this?', 'Decline')) act(b.dataset.decline, false); });
}

const ROLES = [['teacher', 'Teacher'], ['technician', 'Lab technician'], ['admin', 'Head of department (admin)']];
const roleName = r => (ROLES.find(x => x[0] === r) || [, r])[1];
const active = u => !(u.active === false || u.active === 'FALSE');
const AUTH_ERR = { username_taken: 'Someone already has that username. Choose another.', bad_username: 'Usernames can’t be empty or contain spaces.', cannot_remove_yourself: 'You can’t remove your own account.' };

function people(p) {
  const signIn = u => u.mustChange ? '<span class="pill warn">Temporary password</span>' : u.hasPassword ? '<span class="pill ok">Password set</span>' : u.email && u.email.includes('@') && !isDemo() && CONFIG.GOOGLE_CLIENT_ID ? '<span class="pill">Google only</span>' : '<span class="pill urgent">No password</span>';
  const users = db.users.slice().sort((a, b) => (a.role + a.name).localeCompare(b.role + b.name));
  p.innerHTML = `<div class="row between wrap"><p class="muted" style="max-width:640px">Add each person with their name, a username and their role. They get a temporary password to sign in with once, then choose their own. For teachers, use the name exactly as it appears on the timetable so their lessons show up.</p><button class="btn pri" id="addu">+ Add person</button></div>
    <section class="card flush scroll"><table class="tbl"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Sign-in</th><th>Active</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr><td class="strong">${esc(u.name)}</td><td>${esc(u.email || '—')}</td><td>${esc(roleName(u.role))}</td><td>${signIn(u)}</td><td>${active(u) ? 'Yes' : '<span class="muted">No</span>'}</td>
      <td class="right" style="white-space:nowrap"><button class="btn small" data-reset="${esc(u.email)}">${u.hasPassword ? 'Reset password' : 'Create password'}</button> <button class="btn small" data-u="${esc(u.email)}">Edit</button></td></tr>`).join('')}</tbody></table></section>`;
  const teachers = [...new Set(db.timetable.map(t => t.teacher))].sort();
  const showTemp = (u, temp) => {
    const d = modal(`<div class="row between"><h2 class="h2">Temporary password for ${esc(u.name)}</h2><button class="icon-btn" data-close aria-label="Close">×</button></div>
      <p>Give these to ${esc(u.name)}. They’ll choose their own password the first time they sign in.</p>
      <dl class="dl" style="font-size:16px"><dt>Username</dt><dd><strong>${esc(u.email)}</strong></dd><dt>Temporary password</dt><dd><code id="tmp" style="font-size:20px;font-weight:700;letter-spacing:.04em">${esc(temp)}</code></dd></dl>
      <div class="note warn">This password is shown only once. If it gets lost, use <strong>Reset password</strong> to make a new one.</div>
      <div class="row end gap"><button class="btn" id="copyTmp">Copy username and password</button><button class="btn pri" data-close>Done</button></div>`);
    d.querySelector('#copyTmp').onclick = async () => { try { await navigator.clipboard.writeText(`Science Practicals\nUsername: ${u.email}\nTemporary password: ${temp}\n${location.origin + location.pathname}`); toast('Copied'); } catch (e) { toast('Select the password and copy it by hand', 'bad'); } };
  };
  const edit = u => {
    const isNew = !u.email;
    const d = modal(`<div class="row between"><h2 class="h2">${isNew ? 'Add person' : 'Edit ' + esc(u.name)}</h2><button class="icon-btn" data-close aria-label="Close">×</button></div>
      <form id="uf" class="stack"><label class="fld">Name (as on the timetable)<input name="name" list="tnames" value="${esc(u.name || '')}" required><datalist id="tnames">${teachers.map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
      <label class="fld">Username${isNew ? ' — or their school email, if they’ll also sign in with Google' : ''}<input name="email" value="${esc(u.email || '')}" autocapitalize="none" spellcheck="false" pattern="\\S+" title="No spaces" required ${isNew ? '' : 'readonly'}></label>
      ${isNew ? '' : '<p class="muted xs" style="margin-top:-6px">A username can’t be changed, because past requests are filed under it. To change it, remove the person and add them again.</p>'}
      <label class="fld">Role<select name="role">${ROLES.map(([k, l]) => `<option value="${k}"${u.role === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="active" ${active(u) ? 'checked' : ''}> Can sign in</label>
      ${isNew ? '<label class="check"><input type="checkbox" name="makePassword" checked> Make a temporary password now</label>' : ''}
      <p id="uerr" class="err small" role="alert"></p>
      <div class="row between">${isNew ? '<span></span>' : '<button type="button" class="btn danger-outline" id="delu">Remove</button>'}<div class="row gap"><button type="button" class="btn" data-close>Cancel</button><button class="btn pri">${isNew ? 'Add person' : 'Save'}</button></div></div></form>`);
    if (isNew) { const nm = d.querySelector('[name=name]'), un = d.querySelector('[name=email]'); let touched = false;
      un.oninput = () => { touched = true; };
      nm.oninput = () => { if (!touched) un.value = nm.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, ''); }; }
    d.querySelector('#uf').onsubmit = async e => {
      e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      try {
        const out = await call('saveUser', { isNew, makePassword: !!f.makePassword, user: { email: f.email.trim().toLowerCase(), name: f.name.trim(), role: f.role, active: !!f.active } });
        closeModal(); await reload();
        if (out.tempPassword) showTemp(out.user, out.tempPassword); else toast('Saved');
      } catch (err) { d.querySelector('#uerr').textContent = AUTH_ERR[err.message] || err.message; }
    };
    const del = d.querySelector('#delu'); if (del) del.onclick = async () => { if (await confirmBox('Remove ' + u.name + '? They will no longer be able to sign in.', 'Remove')) { try { await call('removeUser', { email: u.email }); reload(); } catch (err) { toast(AUTH_ERR[err.message] || err.message, 'bad'); } } };
  };
  $('#addu', p).onclick = () => edit({ role: 'teacher', active: true });
  p.querySelectorAll('[data-u]').forEach(b => b.onclick = () => edit(db.users.find(u => u.email === b.dataset.u)));
  p.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    const u = db.users.find(x => x.email === b.dataset.reset);
    if (!(await confirmBox(`Make a new temporary password for ${u.name}? ${u.hasPassword ? 'Their current password stops working.' : ''}`, 'Make password'))) return;
    try { const out = await call('resetPassword', { email: u.email }); await reload(); showTemp(out.user, out.tempPassword); } catch (err) { toast(AUTH_ERR[err.message] || err.message, 'bad'); }
  });
}

function settings(p) {
  const s = db.settings;
  p.innerHTML = `<form id="sf" class="card stack" style="max-width:640px">
    <div class="row between"><h2 class="h2">Booking rules</h2><button class="btn pri">Save settings</button></div>
    <label class="fld">School name<input name="schoolName" value="${esc(s.schoolName || '')}"></label>
    <label class="fld">Working days technicians need before a practical<input name="leadDays" type="number" min="0" max="10" value="${esc(s.leadDays)}"></label>
    <p class="muted small">With 3: a Monday practical must be booked by the end of the Wednesday before. Weekends and the holidays below are skipped.</p>
    <label class="fld">Lesson periods per day (for the lab-booking chart)<input name="periodsPerDay" type="number" min="1" max="12" value="${esc(s.periodsPerDay || 6)}"></label>
    <div class="grid2"><label class="fld">Day starts<input name="dayStart" type="time" value="${esc(s.dayStart || '08:30')}"></label><label class="fld">Day ends<input name="dayEnd" type="time" value="${esc(s.dayEnd || '16:00')}"></label></div>
    <label class="fld">Holidays and non-working days (one date per line, YYYY-MM-DD)<textarea name="holidays" rows="6">${esc((s.holidays || []).join('\n'))}</textarea></label></form>`;
  $('#sf', p).onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    const holidays = f.holidays.split(/[\s,]+/).map(x => x.trim()).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
    const row = { schoolName: f.schoolName, leadDays: Number(f.leadDays) || 3, periodsPerDay: Number(f.periodsPerDay) || 6, dayStart: f.dayStart, dayEnd: f.dayEnd, holidays };
    try { await call('importTable', { table: 'Settings', rows: { ...db.settings, ...row }, mode: 'replace' }); toast('Settings saved'); await reload(); } catch (err) { toast(err.message, 'bad'); }
  };
}

function data(p) {
  const opts = TABLES.map(t => `<option>${t}</option>`).join('');
  p.innerHTML = `<div class="cols halves"><section class="card stack"><h2 class="h2">Export</h2><p class="muted">Download one table, or everything as a single backup file.</p>
      <label class="fld">Table<select id="et">${opts}</select></label>
      <div class="row gap wrap"><button class="btn" id="ejson">Download JSON</button><button class="btn" id="ecsv">Download CSV (opens in Excel)</button></div>
      <hr><button class="btn pri" id="eall">Download full backup</button></section>
    <section class="card stack"><h2 class="h2">Import</h2><p class="muted">Use the files in the <strong>school-data</strong> folder to load your real timetable, inventory and library, or a CSV saved from Excel.</p>
      <label class="fld">Table<select id="it">${opts}</select></label>
      <label class="fld">File (.json or .csv)<input type="file" id="if" accept=".json,.csv,application/json,text/csv"></label>
      <fieldset class="seg-radio"><legend class="small">How</legend><label><input type="radio" name="mode" value="replace" checked> Replace the table</label> <label><input type="radio" name="mode" value="append"> Add to the table</label></fieldset>
      <button class="btn pri" id="ido">Import</button>
      <hr><h3 class="h3">Restore a full backup</h3><input type="file" id="bf" accept=".json"><button class="btn danger-outline" id="bdo">Restore everything from backup</button></section></div>
    ${isDemo() ? '<p class="note warn">Not connected to the Google Sheet yet (config.js has no API_URL), so imports are kept in this browser only.</p>' : ''}`;
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
