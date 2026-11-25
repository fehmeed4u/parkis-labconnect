/**
 * Science Practicals — Google Apps Script backend.
 *
 * The Google Sheet this script is bound to is the database: one tab per table.
 * The web app (GitHub Pages) calls this script's web-app URL with POST requests.
 * Every request carries a Google sign-in ID token, which is checked here.
 *
 * Setup (see README):
 *   1. Create a Google Sheet, open Extensions → Apps Script, paste this file + appsscript.json.
 *   2. Project Settings → Script properties:
 *        CLIENT_ID     = your Google OAuth client ID (same as in assets/js/config.js)
 *        ADMIN_EMAILS  = comma-separated emails that are always admins (e.g. the HOD)
 *        SCHOOL_DOMAIN = optional, e.g. parkis.pt — only accounts from this domain may sign in
 *   3. Run setup() once (creates the tabs). Then Deploy → New deployment → Web app,
 *      Execute as: Me, Who has access: Anyone. Copy the /exec URL into config.js.
 *   4. In the app, Admin → Import, load the school-data JSON files.
 */

var TABLES = {
  Settings:     ['key', 'value'],
  Users:        ['email', 'name', 'role', 'active'],
  Labs:         ['room', 'name', 'building', 'type'],
  Timetable:    ['id', 'teacher', 'day', 'start', 'end', 'subject', 'code', 'class', 'grade', 'course', 'room'],
  Inventory:    ['id', 'list', 'category', 'name', 'size', 'rooms', 'storage', 'min', 'orderRequired', 'supplier', 'ref', 'hazcards', 'icon', 'photo', 'shelfLife', 'storageGroup', 'notes', 'orderApproved'],
  InventoryLog: ['at', 'by', 'itemId', 'item', 'room', 'change', 'reason'],
  Hazcards:     ['code', 'title', 'url'],
  Library:      ['id', 'title', 'grade', 'subject', 'course', 'topic', 'kit', 'prepMinutes', 'method'],
  Requests:     ['id', 'createdAt', 'updatedAt', 'teacherEmail', 'teacher', 'class', 'grade', 'subject', 'date', 'start', 'end', 'room', 'timetabledRoom', 'practicalId', 'title', 'sets', 'kit', 'notes', 'status', 'prep', 'late', 'lateChoice', 'swapWith', 'offer', 'techNotes', 'rating', 'feedback', 'history', 'query', 'reply', 'hodApproved']
};
var JSON_COLS = { rooms: 1, storage: 1, hazcards: 1, kit: 1, history: 1, value: 1 };
var WRITE_ROLES = {
  Settings: ['admin'], Users: ['admin'], Labs: ['admin'], Timetable: ['admin'], Hazcards: ['admin'],
  Inventory: ['admin', 'technician'], Library: ['admin', 'technician', 'teacher']
};

/* ---------- entry points ---------- */

function doGet() {
  return json_({ ok: true, app: 'science-practicals', time: new Date().toISOString() });
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  try {
    var me = auth_(body.idToken);
    var out = route_(body.action, body.data || {}, me);
    return json_({ ok: true, me: me, data: out });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- auth ---------- */

function auth_(idToken) {
  if (!idToken) throw new Error('not_signed_in');
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  var cached = cache.get('tok_' + idToken.slice(-40));
  var info;
  if (cached) info = JSON.parse(cached);
  else {
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('bad_token');
    info = JSON.parse(res.getContentText());
    cache.put('tok_' + idToken.slice(-40), JSON.stringify(info), 600);
  }
  if (info.aud !== props.getProperty('CLIENT_ID')) throw new Error('wrong_client');
  if (String(info.email_verified) !== 'true') throw new Error('email_not_verified');
  var domain = props.getProperty('SCHOOL_DOMAIN');
  var email = String(info.email).toLowerCase();
  if (domain && email.split('@')[1] !== domain.toLowerCase()) throw new Error('wrong_domain');
  var admins = (props.getProperty('ADMIN_EMAILS') || '').toLowerCase().split(',').map(function (s) { return s.trim(); });
  var users = read_('Users');
  var u = users.filter(function (x) { return String(x.email).toLowerCase() === email; })[0];
  if (admins.indexOf(email) >= 0) return { email: email, name: (u && u.name) || info.name || email, role: 'admin' };
  if (!u || u.active === false || String(u.active).toUpperCase() === 'FALSE') throw new Error('not_registered:' + email);
  return { email: email, name: u.name || info.name, role: u.role || 'teacher' };
}

/* ---------- router ---------- */

function route_(action, d, me) {
  switch (action) {
    case 'bootstrap': return bootstrap_(me);
    case 'saveRequest': return saveRequest_(d.request, me);
    case 'updateRequest': return updateRequest_(d.id, d.patch, me);
    case 'adjustStock': return adjustStock_(d, me);
    case 'upsert': return upsert_(d.table, d.row, me);
    case 'remove': return remove_(d.table, d.key, me);
    case 'importTable': return importTable_(d.table, d.rows, d.mode, me);
    case 'exportTable': requireRole_(me, ['admin', 'technician']); return read_(d.table);
    default: throw new Error('unknown_action');
  }
}

function requireRole_(me, roles) { if (roles.indexOf(me.role) < 0) throw new Error('forbidden'); }

function bootstrap_(me) {
  var settings = {};
  read_('Settings').forEach(function (r) { settings[r.key] = r.value; });
  return {
    settings: settings,
    users: me.role === 'admin' ? read_('Users') : read_('Users').map(function (u) { return { email: u.email, name: u.name, role: u.role }; }),
    labs: read_('Labs'), timetable: read_('Timetable'), inventory: read_('Inventory'),
    hazcards: read_('Hazcards'), library: read_('Library'), requests: read_('Requests'),
    log: me.role === 'teacher' ? [] : read_('InventoryLog').slice(-300)
  };
}

/* ---------- requests ---------- */

function saveRequest_(r, me) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var now = new Date().toISOString();
    var rows = read_('Requests');
    var existing = r.id ? rows.filter(function (x) { return x.id === r.id; })[0] : null;
    if (existing && me.role === 'teacher' && existing.teacherEmail !== me.email) throw new Error('forbidden');
    if (!existing) { r.id = 'r' + Utilities.getUuid().slice(0, 8); r.createdAt = now; r.teacherEmail = me.email; r.teacher = r.teacher || me.name; }
    r.updatedAt = now;
    r.history = (existing && existing.history || []).concat([{ at: now, by: me.name, what: existing ? 'edited' : (r.status === 'draft' ? 'draft saved' : 'submitted') }]);
    if (me.role === 'teacher' && existing && ['accepted', 'in_progress', 'ready'].indexOf(existing.status) >= 0) r.status = 'submitted'; // changes go back to the technicians
    writeRow_('Requests', 'id', Object.assign({}, existing || {}, r));
    return r;
  } finally { lock.releaseLock(); }
}

function updateRequest_(id, patch, me) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var r = read_('Requests').filter(function (x) { return x.id === id; })[0];
    if (!r) throw new Error('not_found');
    var teacherFields = ['status', 'rating', 'feedback', 'lateChoice', 'reply', 'query'];
    if (me.role === 'teacher') {
      if (r.teacherEmail !== me.email) throw new Error('forbidden');
      Object.keys(patch).forEach(function (k) { if (teacherFields.indexOf(k) < 0) throw new Error('forbidden_field:' + k); });
      if (patch.status && ['cancelled', 'done', 'submitted'].indexOf(patch.status) < 0) throw new Error('forbidden_status');
    }
    var now = new Date().toISOString();
    var what = Object.keys(patch).map(function (k) { return k + ' → ' + (typeof patch[k] === 'object' ? JSON.stringify(patch[k]) : patch[k]); }).join(', ');
    r = Object.assign(r, patch, { updatedAt: now });
    r.history = (r.history || []).concat([{ at: now, by: me.name, what: what }]);
    writeRow_('Requests', 'id', r);
    return r;
  } finally { lock.releaseLock(); }
}

/* ---------- inventory ---------- */

function adjustStock_(d, me) {
  requireRole_(me, ['admin', 'technician']);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var item = read_('Inventory').filter(function (x) { return x.id === d.itemId; })[0];
    if (!item) throw new Error('not_found');
    var rooms = item.rooms || {};
    rooms[d.room] = Math.max(0, (Number(rooms[d.room]) || 0) + Number(d.change));
    item.rooms = rooms;
    writeRow_('Inventory', 'id', item);
    appendRow_('InventoryLog', { at: new Date().toISOString(), by: me.name, itemId: item.id, item: item.name + (item.size ? ' ' + item.size : ''), room: d.room, change: d.change, reason: d.reason || '' });
    return item;
  } finally { lock.releaseLock(); }
}

/* ---------- generic tables ---------- */

function upsert_(table, row, me) {
  requireRole_(me, WRITE_ROLES[table] || ['admin']);
  var key = TABLES[table][0];
  if (!row[key]) row[key] = (table === 'Inventory' ? 'i' : table === 'Library' ? 'p' : 'x') + Utilities.getUuid().slice(0, 8);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { writeRow_(table, key, row); } finally { lock.releaseLock(); }
  return row;
}

function remove_(table, keyValue, me) {
  requireRole_(me, WRITE_ROLES[table] || ['admin']);
  var sh = sheet_(table), key = TABLES[table][0];
  var data = sh.getDataRange().getValues(); var col = data[0].indexOf(key);
  for (var i = data.length - 1; i >= 1; i--) if (String(data[i][col]) === String(keyValue)) sh.deleteRow(i + 1);
  return true;
}

function importTable_(table, rows, mode, me) {
  requireRole_(me, ['admin']);
  if (!TABLES[table]) throw new Error('unknown_table');
  var sh = sheet_(table), head = TABLES[table];
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (table === 'Settings' && !Array.isArray(rows)) rows = Object.keys(rows).map(function (k) { return { key: k, value: rows[k] }; });
    if (mode !== 'append' && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, head.length).clearContent();
    if (!rows.length) return 0;
    var values = rows.map(function (r) { return head.map(function (h) { return enc_(h, r[h]); }); });
    sh.getRange(sh.getLastRow() + 1, 1, values.length, head.length).setValues(values);
    return values.length;
  } finally { lock.releaseLock(); }
}

/* ---------- sheet helpers ---------- */

function sheet_(name) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]).setFontWeight('bold'); sh.setFrozenRows(1); }
  else if (sh.getLastColumn() < TABLES[name].length) sh.getRange(1, 1, 1, TABLES[name].length).setValues([TABLES[name]]).setFontWeight('bold'); // new columns added in an update
  return sh;
}
function enc_(h, v) { if (v === undefined || v === null) return ''; return JSON_COLS[h] || typeof v === 'object' ? JSON.stringify(v) : v; }
function dec_(h, v) {
  if (JSON_COLS[h] && typeof v === 'string' && v !== '' && /^[\[{"]/.test(v)) { try { return JSON.parse(v); } catch (e) { return v; } }
  if (v instanceof Date) return v.toISOString();
  return v;
}
function read_(name) {
  var sh = sheet_(name); var data = sh.getDataRange().getValues(); var head = data[0];
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i].join('') === '') continue;
    var o = {}; head.forEach(function (h, j) { o[h] = dec_(h, data[i][j]); }); out.push(o);
  }
  return out;
}
function writeRow_(name, key, row) {
  var sh = sheet_(name), head = TABLES[name];
  var data = sh.getDataRange().getValues(); var col = data[0].indexOf(key);
  var values = [head.map(function (h) { return enc_(h, row[h]); })];
  for (var i = 1; i < data.length; i++) if (String(data[i][col]) === String(row[key])) { sh.getRange(i + 1, 1, 1, head.length).setValues(values); return; }
  sh.appendRow(values[0]);
}
function appendRow_(name, row) { sheet_(name).appendRow(TABLES[name].map(function (h) { return enc_(h, row[h]); })); }

/* ---------- one-off helpers (run from the editor) ---------- */

/** Creates every tab with its header row. Run once after pasting the code. */
function setup() {
  Object.keys(TABLES).forEach(sheet_);
  var s = sheet_('Settings');
  if (s.getLastRow() < 2) s.getRange(2, 1, 3, 2).setValues([['leadDays', '3'], ['dayStart', '"08:30"'], ['dayEnd', '"16:00"']]);
  var def = SpreadsheetApp.getActive().getSheetByName('Sheet1'); if (def && def.getLastRow() === 0) SpreadsheetApp.getActive().deleteSheet(def);
}

/**
 * Upload your CLEAPSS Hazcards folder to the school Google Drive, copy the folder ID from its URL
 * into the HAZCARD_FOLDER_ID script property, then run linkHazcards from the editor. Each card PDF is matched by the code at the start of its
 * file name (e.g. "91A - Sodium Hydroxide.pdf") and its preview link is stored in the Hazcards tab.
 * The folder must stay shared with the school (not public), so only staff can open the cards.
 */
function linkHazcards(folderId) {
  folderId = folderId || PropertiesService.getScriptProperties().getProperty('HAZCARD_FOLDER_ID');
  if (!folderId) throw new Error('Set the HAZCARD_FOLDER_ID script property first');
  var files = DriveApp.getFolderById(folderId).getFiles(); var found = {};
  while (files.hasNext()) {
    var f = files.next(); var m = f.getName().match(/^\s*(\d+[A-Za-z]?)/);
    if (m) found[m[1].toUpperCase()] = 'https://drive.google.com/file/d/' + f.getId() + '/preview';
  }
  var rows = read_('Hazcards');
  rows.forEach(function (r) { if (found[r.code]) r.url = found[r.code]; });
  importTable_('Hazcards', rows, 'replace', { role: 'admin' });
  Logger.log('Linked ' + rows.filter(function (r) { return r.url; }).length + ' of ' + rows.length + ' hazcards');
}

/** Nightly copy of the whole sheet into a "Practicals backups" folder. Run installBackup() once. */
function backupNow() {
  var ss = SpreadsheetApp.getActive();
  var it = DriveApp.getFoldersByName('Practicals backups');
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder('Practicals backups');
  DriveApp.getFileById(ss.getId()).makeCopy(ss.getName() + ' backup ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'), folder);
}
function installBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'backupNow') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupNow').timeBased().everyDays(1).atHour(2).create();
}
