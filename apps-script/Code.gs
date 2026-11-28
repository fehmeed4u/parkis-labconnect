/**
 * Science Practicals — Google Apps Script backend.
 *
 * The Google Sheet this script is bound to is the database: one tab per table.
 * The web app (GitHub Pages) calls this script's web-app URL with POST requests.
 * Staff sign in with a username + password the HOD gives them (People & roles), or — if a
 * Google client ID is configured — with their school Google account. Every request carries
 * either a session token from login_() or a Google ID token, and is checked here.
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
  Users:        ['email', 'name', 'role', 'active', 'passwordHash', 'salt', 'mustChange'],
  Labs:         ['room', 'name', 'building', 'type'],
  Timetable:    ['id', 'teacher', 'day', 'start', 'end', 'subject', 'code', 'class', 'grade', 'course', 'room'],
  Inventory:    ['id', 'list', 'category', 'name', 'size', 'rooms', 'storage', 'min', 'orderRequired', 'supplier', 'ref', 'hazcards', 'icon', 'photo', 'shelfLife', 'storageGroup', 'notes', 'orderApproved', 'sds', 'sdsNote', 'altNames'],
  InventoryLog: ['at', 'by', 'itemId', 'item', 'room', 'change', 'reason'],
  Hazcards:     ['code', 'title', 'url'],
  Library:      ['id', 'title', 'grade', 'subject', 'course', 'topic', 'kit', 'prepMinutes', 'method', 'risks', 'prepNotes', 'sets', 'sources'],
  Recipes:      ['number', 'title', 'names', 'hazcards', 'solutes', 'text'],        // from the school's CLEAPSS Recipe Sheets (import file)
  RiskCards:    ['code', 'title', 'signal', 'hazards', 'controls', 'emergency', 'disposal'], // from the school's CLEAPSS Hazcards (import file)
  Requests:     ['id', 'createdAt', 'updatedAt', 'teacherEmail', 'teacher', 'class', 'grade', 'subject', 'date', 'start', 'end', 'room', 'timetabledRoom', 'practicalId', 'title', 'sets', 'kit', 'notes', 'status', 'prep', 'late', 'lateChoice', 'swapWith', 'offer', 'techNotes', 'rating', 'feedback', 'history', 'query', 'reply', 'hodApproved', 'flag', 'postponedFrom', 'method', 'risks', 'activities', 'prepNotes']
};
var AUTH_COLS = ['passwordHash', 'salt', 'mustChange'];
var SESSION_HOURS = 12, HASH_ROUNDS = 2000, MAX_FAILS = 5;
var JSON_COLS = { rooms: 1, storage: 1, hazcards: 1, kit: 1, history: 1, value: 1, risks: 1, activities: 1, names: 1, solutes: 1, hazards: 1, controls: 1, emergency: 1 };
var WRITE_ROLES = {
  Settings: ['admin'], Users: ['admin'], Labs: ['admin'], Timetable: ['admin'], Hazcards: ['admin'], Recipes: ['admin', 'technician'], RiskCards: ['admin', 'technician'],
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
    if (body.action === 'login') return json_({ ok: true, data: login_(body.data || {}) });
    var me = auth_(body.idToken, body.token);
    if (me.mustChange && ['changePassword', 'logout'].indexOf(body.action) < 0) throw new Error('must_change_password');
    if (body.action === 'logout') { if (body.token) PropertiesService.getScriptProperties().deleteProperty('sess_' + body.token); return json_({ ok: true, data: true }); }
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

function truthy_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function isActive_(u) { return !(u.active === false || String(u.active).toUpperCase() === 'FALSE'); }
function admins_() { return (PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '').toLowerCase().split(',').map(function (s) { return s.trim(); }).filter(String); }
function meOf_(u, email) {
  var id = String(u ? u.email : email).toLowerCase();
  return { email: id, name: (u && u.name) || email, role: admins_().indexOf(id) >= 0 ? 'admin' : (u && u.role) || 'teacher',
    hasPassword: !!(u && u.passwordHash), mustChange: !!(u && truthy_(u.mustChange)) };
}
function findUser_(id) { id = String(id || '').trim().toLowerCase(); return read_('Users').filter(function (x) { return String(x.email).toLowerCase() === id; })[0]; }

function auth_(idToken, token) {
  if (token) {
    var props = PropertiesService.getScriptProperties();
    var s = props.getProperty('sess_' + token);
    if (!s) throw new Error('session_expired');
    s = JSON.parse(s);
    if (s.exp < Date.now()) { props.deleteProperty('sess_' + token); throw new Error('session_expired'); }
    var u = findUser_(s.email);
    if (!u || !isActive_(u)) { props.deleteProperty('sess_' + token); throw new Error('not_registered'); }
    return meOf_(u);
  }
  if (!idToken) throw new Error('not_signed_in');
  var props2 = PropertiesService.getScriptProperties();
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
  if (!props2.getProperty('CLIENT_ID') || info.aud !== props2.getProperty('CLIENT_ID')) throw new Error('wrong_client');
  if (String(info.email_verified) !== 'true') throw new Error('email_not_verified');
  var domain = props2.getProperty('SCHOOL_DOMAIN');
  var email = String(info.email).toLowerCase();
  if (domain && email.split('@')[1] !== domain.toLowerCase()) throw new Error('wrong_domain');
  var gu = findUser_(email);
  if (admins_().indexOf(email) >= 0) { var m = meOf_(gu, email); m.name = (gu && gu.name) || info.name || email; m.mustChange = false; return m; }
  if (!gu || !isActive_(gu)) throw new Error('not_registered:' + email);
  var me = meOf_(gu); me.mustChange = false; // Google proves who they are; no temporary password to replace
  return me;
}

/* ---------- username + password ---------- */

function hash_(pw, salt) {
  var p = Utilities.newBlob(String(pw)).getBytes(), k = Utilities.newBlob(String(salt)).getBytes();
  var h = Utilities.computeHmacSha256Signature(p, k);
  for (var i = 0; i < HASH_ROUNDS; i++) h = Utilities.computeHmacSha256Signature(h.concat(k), p);
  return Utilities.base64Encode(h);
}
function same_(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
function tempPassword_() {
  var A = 'abcdefghjkmnpqrstuvwxyz23456789', bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
  var s = ''; for (var i = 0; i < 10; i++) s += A.charAt((bytes[i] + 256) % A.length);
  return s.slice(0, 5) + '-' + s.slice(5);
}
function setPassword_(u, pw, mustChange) { u.salt = Utilities.getUuid(); u.passwordHash = hash_(pw, u.salt); u.mustChange = !!mustChange; }
function endSessions_(email) {
  var props = PropertiesService.getScriptProperties(), all = props.getProperties(), now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('sess_') !== 0) return;
    try { var s = JSON.parse(all[k]); if (s.exp < now || (email && String(s.email).toLowerCase() === String(email).toLowerCase())) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}
function publicUser_(u) { var o = {}; Object.keys(u).forEach(function (k) { if (AUTH_COLS.indexOf(k) < 0) o[k] = u[k]; }); o.hasPassword = !!u.passwordHash; o.mustChange = truthy_(u.mustChange); return o; }

function login_(d) {
  var id = String(d.username || '').trim().toLowerCase();
  if (!id || !d.password) throw new Error('bad_login');
  var cache = CacheService.getScriptCache(), k = 'fail_' + id, fails = Number(cache.get(k) || 0);
  if (fails >= MAX_FAILS) throw new Error('too_many_attempts');
  var u = findUser_(id);
  if (!u || !u.passwordHash || !isActive_(u) || !same_(hash_(d.password, u.salt), u.passwordHash)) { cache.put(k, String(fails + 1), 600); throw new Error('bad_login'); }
  cache.remove(k);
  endSessions_(); // tidy up expired ones
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('sess_' + token, JSON.stringify({ email: u.email, exp: Date.now() + SESSION_HOURS * 3600 * 1000 }));
  return { token: token, me: meOf_(u) };
}

function changePassword_(d, me) {
  if (String(d.password || '').length < 8) throw new Error('password_too_short');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var u = findUser_(me.email); if (!u) throw new Error('not_registered');
    if (!truthy_(u.mustChange) && (!u.passwordHash || !same_(hash_(d.current || '', u.salt), u.passwordHash))) throw new Error('wrong_current_password');
    if (u.passwordHash && same_(hash_(d.password, u.salt), u.passwordHash)) throw new Error('same_password');
    setPassword_(u, d.password, false); writeRow_('Users', 'email', u);
    return meOf_(u);
  } finally { lock.releaseLock(); }
}

/** HOD adds or edits a person. New people (or makePassword) get a temporary password, returned once. */
function saveUser_(d, me) {
  requireRole_(me, ['admin']);
  var row = d.user || {}; var id = String(row.email || '').trim().toLowerCase();
  if (!id || /\s/.test(id)) throw new Error('bad_username');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var ex = findUser_(id);
    if (d.isNew && ex) throw new Error('username_taken');
    if (!d.isNew && !ex) throw new Error('not_found');
    var u = { email: ex ? ex.email : id, name: String(row.name || '').trim(), role: ['teacher', 'technician', 'admin'].indexOf(row.role) >= 0 ? row.role : 'teacher', active: isActive_(row) };
    AUTH_COLS.forEach(function (c) { if (ex) u[c] = ex[c]; });
    var temp = '';
    if (d.makePassword) { temp = tempPassword_(); setPassword_(u, temp, true); endSessions_(id); }
    if (!u.active) endSessions_(id);
    writeRow_('Users', 'email', u);
    return { user: publicUser_(u), tempPassword: temp };
  } finally { lock.releaseLock(); }
}
function removeUser_(id, me) {
  requireRole_(me, ['admin']);
  if (String(id).toLowerCase() === String(me.email).toLowerCase()) throw new Error('cannot_remove_yourself');
  remove_('Users', String(id).toLowerCase(), me); endSessions_(id); return true;
}

/**
 * Run from the editor to make three test sign-ins: test.teacher, test.labtech and test.hod.
 * Each gets a new random password (written to the execution log) that does not need changing,
 * so you can sign in as each role to try things out. Running it again gives new passwords.
 * The test teacher uses the TEST_TEACHER_NAME script property (a name from the timetable) so they
 * see real lessons; otherwise the first teacher on the timetable. Run removeTestAccounts() when done.
 */
function makeTestAccounts() {
  var tt = read_('Timetable'); var teacher = PropertiesService.getScriptProperties().getProperty('TEST_TEACHER_NAME') || (tt[0] && tt[0].teacher) || 'Test Teacher';
  var lines = [];
  [['test.teacher', teacher, 'teacher'], ['test.labtech', 'Test Lab Technician', 'technician'], ['test.hod', 'Test Head of Department', 'admin']].forEach(function (a) {
    var u = findUser_(a[0]) || { email: a[0] };
    u.name = a[1]; u.role = a[2]; u.active = true;
    var pw = tempPassword_() + '-' + tempPassword_().slice(0, 4); setPassword_(u, pw, false);
    writeRow_('Users', 'email', u); endSessions_(a[0]);
    lines.push(a[2] + ':  username ' + a[0] + '   password ' + pw);
  });
  Logger.log('Test sign-ins (delete with removeTestAccounts when you are done):\n' + lines.join('\n'));
}
function removeTestAccounts() {
  ['test.teacher', 'test.labtech', 'test.hod'].forEach(function (id) { remove_('Users', id, { role: 'admin' }); endSessions_(id); });
  Logger.log('Test accounts removed.');
}

/**
 * Run from the editor to get the first HOD in without Google sign-in. Creates (or resets) the user named in the
 * ADMIN_USERNAME script property (default "hod") as an admin and writes a temporary password to the execution log.
 */
function makeFirstAdmin() {
  var id = (PropertiesService.getScriptProperties().getProperty('ADMIN_USERNAME') || 'hod').trim().toLowerCase();
  var u = findUser_(id) || { email: id, name: 'Head of department', role: 'admin', active: true };
  u.role = 'admin'; u.active = true; var temp = tempPassword_(); setPassword_(u, temp, true);
  writeRow_('Users', 'email', u); endSessions_(id);
  Logger.log('Sign in as "' + id + '" with the temporary password: ' + temp + ' — you will be asked to choose your own.');
}

/* ---------- router ---------- */

function route_(action, d, me) {
  switch (action) {
    case 'bootstrap': return bootstrap_(me);
    case 'saveRequest': return saveRequest_(d.request, me);
    case 'updateRequest': return updateRequest_(d.id, d.patch, me);
    case 'postponeRequest': return postponeRequest_(d.id, d.slot, me);
    case 'adjustStock': return adjustStock_(d, me);
    case 'upsert': return upsert_(d.table, d.row, me);
    case 'remove': return remove_(d.table, d.key, me);
    case 'importTable': return importTable_(d.table, d.rows, d.mode, me);
    case 'exportTable': requireRole_(me, ['admin', 'technician']); return d.table === 'Users' ? read_('Users').map(publicUser_) : read_(d.table);
    case 'changePassword': return changePassword_(d, me);
    case 'saveUser': return saveUser_(d, me);
    case 'resetPassword': return saveUser_({ user: publicUser_(findUser_(d.email) || {}), makePassword: true }, me);
    case 'removeUser': return removeUser_(d.email, me);
    default: throw new Error('unknown_action');
  }
}

function requireRole_(me, roles) { if (roles.indexOf(me.role) < 0) throw new Error('forbidden'); }

function bootstrap_(me) {
  var settings = {};
  read_('Settings').forEach(function (r) { settings[r.key] = r.value; });
  return {
    settings: settings,
    users: me.role === 'admin' ? read_('Users').map(publicUser_) : read_('Users').map(function (u) { return { email: u.email, name: u.name, role: u.role }; }),
    labs: read_('Labs'), timetable: read_('Timetable'), inventory: read_('Inventory'),
    hazcards: read_('Hazcards'), library: read_('Library'), requests: read_('Requests'), recipes: read_('Recipes'), riskcards: read_('RiskCards'),
    log: me.role === 'teacher' ? [] : read_('InventoryLog').slice(-300)
  };
}

/* ---------- requests ---------- */

/* Request rules — the same as ruleSave / ruleUpdate / rulePostpone in assets/js/logic.js; keep the two in step.
   draft → accepted (sent on time: booked straight away) or submitted (sent late: waiting for approval)
   accepted → in_progress → ready → done, or rejected / cancelled. Teachers can change or cancel only until preparation starts. */
function notStarted_(r) { return r.status === 'submitted' || (r.status === 'accepted' && !(Number(r.prep) > 0)); }
function teacherCanEdit_(r) { return r.status === 'draft' || notStarted_(r); }
function canPostpone_(r) { return ['submitted', 'accepted', 'in_progress', 'ready'].indexOf(r.status) >= 0; }
function at_(date, start) { return date + ' ' + start; }
function isoDay_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function isLate_(dateStr) {
  var settings = {}; read_('Settings').forEach(function (r) { settings[r.key] = r.value; });
  var lead = Number(settings.leadDays) || 3, hol = Array.isArray(settings.holidays) ? settings.holidays : [];
  var p = String(dateStr).split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]), n = 0;
  while (n < lead) { d.setDate(d.getDate() - 1); var k = d.getDay(); if (k !== 0 && k !== 6 && hol.indexOf(isoDay_(d)) < 0) n++; }
  return isoDay_(new Date()) > isoDay_(d);
}
function ownRequest_(r, me) { return r.teacherEmail === me.email; }

function saveRequest_(r, me) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var now = new Date().toISOString();
    var rows = read_('Requests');
    var ex = r.id ? rows.filter(function (x) { return x.id === r.id; })[0] : null;
    var staff = me.role !== 'teacher';
    if (ex && !staff && !ownRequest_(ex, me)) throw new Error('forbidden');
    if (ex && !staff && !teacherCanEdit_(ex)) throw new Error('locked');
    if (r.status === 'draft') { if (ex && ex.status !== 'draft') throw new Error('already_sent'); r.prep = 0; }
    else {
      var late = isLate_(r.date);
      if (!ex || ex.status === 'draft') { r.late = late; r.status = staff || !late ? 'accepted' : 'submitted'; r.prep = 0; }
      else {
        r.prep = ex.prep; r.late = ex.late;
        if (staff) r.status = ex.status;
        else {
          var moved = at_(r.date, r.start) !== at_(ex.date, ex.start);
          if (ex.status === 'submitted') { r.status = late ? 'submitted' : 'accepted'; r.late = late; }
          else if (moved && late && at_(r.date, r.start) < at_(ex.date, ex.start)) { r.status = 'submitted'; r.late = true; }
          else r.status = 'accepted';
          r.flag = 'Changed by the teacher';
        }
      }
    }
    if (!ex) {
      r.id = 'r' + Utilities.getUuid().slice(0, 8); r.createdAt = now; r.teacher = r.teacher || me.name;
      var owner = staff ? read_('Users').filter(function (u) { return u.name === r.teacher && u.role === 'teacher'; })[0] : null; // ordered for a teacher: it is theirs
      r.teacherEmail = owner ? String(owner.email).toLowerCase() : me.email;
    }
    else { r.teacherEmail = ex.teacherEmail; r.createdAt = ex.createdAt; }
    r.updatedAt = now;
    r.history = (ex && ex.history || []).concat([{ at: now, by: me.name, what: ex ? 'edited' : (r.status === 'draft' ? 'draft saved' : r.status === 'submitted' ? 'sent late — waiting for approval' : 'booked') }]);
    writeRow_('Requests', 'id', Object.assign({}, ex || {}, r));
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
      if (!ownRequest_(r, me)) throw new Error('forbidden');
      Object.keys(patch).forEach(function (k) { if (teacherFields.indexOf(k) < 0) throw new Error('forbidden_field:' + k); });
      if (patch.status === 'cancelled') { if (!teacherCanEdit_(r)) throw new Error('locked'); if (r.status !== 'draft') patch.flag = 'Cancelled by the teacher'; }
      else if (patch.status && patch.status !== 'done') throw new Error('forbidden_status');
    }
    return writeRequestPatch_(r, patch, me, Object.keys(patch).map(function (k) { return k + ' → ' + (typeof patch[k] === 'object' ? JSON.stringify(patch[k]) : patch[k]); }).join(', '));
  } finally { lock.releaseLock(); }
}

function postponeRequest_(id, slot, me) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var r = read_('Requests').filter(function (x) { return x.id === id; })[0];
    if (!r) throw new Error('not_found');
    if (me.role === 'teacher' && !ownRequest_(r, me)) throw new Error('forbidden');
    if (!canPostpone_(r)) throw new Error('cannot_postpone');
    var now = new Date(), nowAt = isoDay_(now) + ' ' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm');
    if (at_(slot.date, slot.start) <= nowAt) throw new Error('lesson_started');
    if (me.role === 'teacher' && at_(slot.date, slot.start) <= at_(r.date, r.start)) throw new Error('not_later');
    var p = String(r.date).split('-').map(Number);
    var from = Utilities.formatDate(new Date(p[0], p[1] - 1, p[2]), Session.getScriptTimeZone(), 'EEE d MMM') + ' ' + r.start;
    var patch = { date: slot.date, start: slot.start, end: slot.end, room: slot.room, timetabledRoom: slot.timetabledRoom || slot.room,
      postponedFrom: r.postponedFrom || at_(r.date, r.start), flag: 'Postponed by the ' + (me.role === 'teacher' ? 'teacher' : 'technicians') + ' from ' + from };
    return writeRequestPatch_(r, patch, me, 'postponed to ' + slot.date + ' ' + slot.start);
  } finally { lock.releaseLock(); }
}

function writeRequestPatch_(r, patch, me, what) {
  var now = new Date().toISOString();
  r = Object.assign(r, patch, { updatedAt: now });
  r.history = (r.history || []).concat([{ at: now, by: me.name, what: what }]);
  writeRow_('Requests', 'id', r);
  return r;
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
  if (table === 'Users') throw new Error('use_saveUser');
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
    if (table === 'Users') { // never take passwords from a file; keep the ones people already have
      var old = {}; read_('Users').forEach(function (u) { old[String(u.email).toLowerCase()] = u; });
      rows = rows.map(function (r) { var o = old[String(r.email || '').toLowerCase()] || {}; var n = {}; Object.keys(r).forEach(function (k) { n[k] = r[k]; });
        n.email = String(r.email || '').trim().toLowerCase(); AUTH_COLS.forEach(function (c) { n[c] = o[c] || ''; }); return n; });
    }
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
function enc_(h, v) {
  if (v === undefined || v === null) return '';
  // Keep these as text, or the Sheet turns them into dates: a grade range ("11-12"),
  // a time ("08:30") or a day ("2026-11-30").
  if (typeof v === 'string' && !JSON_COLS[h] && (/^\s*\d{1,2}:\d{2}(:\d{2})?\s*$/.test(v) || /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ||
      (h === 'grade' && /^\s*\d{1,2}\s*[-–\/,&]/.test(v)))) return "'" + v.trim();
  return JSON_COLS[h] || typeof v === 'object' ? JSON.stringify(v) : v;
}
function dec_(h, v) {
  if (JSON_COLS[h] && typeof v === 'string' && v !== '' && /^[\[{"]/.test(v)) { try { return JSON.parse(v); } catch (e) { return v; } }
  if (v instanceof Date) {
    // the Sheet already turned a time or a day into a date: give back what was typed
    if (v.getFullYear() < 1901) return Utilities.formatDate(v, sheetTz_(), 'HH:mm');
    if (DAY_COLS[h]) return Utilities.formatDate(v, sheetTz_(), 'yyyy-MM-dd');
    return v.toISOString();
  }
  return v;
}
var DAY_COLS = { date: 1 };
var TZ_ = null;
function sheetTz_() { return TZ_ || (TZ_ = SpreadsheetApp.getActive().getSpreadsheetTimeZone() || Session.getScriptTimeZone()); }
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

/* ---------- SDS matching (ES5: the same code is in apps-script/Code.gs) ---------- */
// Old and IUPAC names of the same chemical. Either side finds the other.
var SDS_SYNONYMS = [
  ['ethanoic acid', 'acetic acid'], ['propanone', 'acetone'], ['ethyl ethanoate', 'ethyl acetate'], ['methyl ethanoate', 'methyl acetate'],
  ['methanoic acid', 'formic acid'], ['propanoic acid', 'propionic acid'], ['octadecanoic acid', 'stearic acid'], ['ethanedioic acid', 'oxalic acid'],
  ['2-hydroxypropane-1,2,3-tricarboxylic acid', 'citric acid'], ['benzene-1,2,3-triol', 'pyrogallol'], ['sodium hydrogencarbonate', 'sodium bicarbonate'], ['sodium hydrogen carbonate', 'sodium bicarbonate'], ['sodium hydrogensulfite', 'sodium bisulfite'],
  ['lead(iv) oxide', 'lead iv dioxide'], ['lead(iv) oxide', 'lead dioxide'], ['paraffin liquid', 'liquid paraffin'],
  ['n-hexane', 'hexane'], ['n-pentane', 'pentane'], ['hydrogencarbonate indicator', 'bicarbonate indicator'], ['hydrogen carbonate indicator', 'bicarbonate indicator'],
  ['calcium hydroxide solution', 'limewater'], ['iodine solution', 'lugol solution'], ['iodine in potassium iodide', 'lugol solution'], ['d-glucose', 'glucose'],
  ['ethylenediaminetetraacetic acid', 'edta'], ['ethylene diamine tetraacetic acid', 'edta'], ['diastase', 'amylase'], ['dcpip', 'dichlorophenolindophenol'],
  ['manganese(iv) oxide', 'manganese dioxide'], ['petroleum ether', 'petroleum spirit'], ['ethoxyethane', 'diethyl ether'], ['2-chloro-2-methylpropane', 'chloro-2-methylpropane'],
  ['nitric acid', 'nitric acid'], ['sulfuric acid', 'sulfuric acid']
];
var ROMAN = '(?:i|ii|iii|iv|v|vi|vii)';
function sdsBase_(name) {
  var s = String(name || '').toLowerCase().replace(/\.(pdf|docx?)$/i, '').replace(/\(\d+\)\s*$/, '').replace(/_/g, ' ');
  s = s.replace(/sulph/g, 'sulf').replace(/aluminum/g, 'aluminium').replace(/phtal/g, 'phthal').replace(/meagnesium/g, 'magnesium').replace(/sullf/g, 'sulf')
    .replace(/a?n?hydrous(?=[a-z])/g, 'anhydrous ').replace(/ahydrous/g, 'anhydrous').replace(/^\d*[.,]\d+(?=[a-z])/, '').replace(/[àâä]/g, 'a').replace(/[éèê]/g, 'e');
  // old ion names whose Roman numeral changes the chemical
  s = s.replace(/chlorate\s*\(\s*i\s*\)/g, 'hypochlorite').replace(/manganate\s*\(\s*vii\s*\)/g, 'permanganate').replace(/sulfate\s*\(\s*iv\s*\)/g, 'sulfite').replace(/nitrate\s*\(\s*iii\s*\)/g, 'nitrite');
  s = s.replace(new RegExp('(ic|ous|ate|ite)\\s*\\(\\s*' + ROMAN + '\\s*\\)', 'g'), '$1');   // sulfate(VI), nitric(V) acid → sulfate, nitric acid
  s = s.replace(/\b([a-z]+?)an\s*-?\s*(\d)\s*-?\s*ol\b/g, '$2$1anol').replace(/\b(\d)\s*-?\s*([a-z]+anol)\b/g, '$1$2'); // propan-1-ol, 1-propanol → 1propanol
  s = s.replace(new RegExp('\\(\\s*(' + ROMAN + ')\\s*\\)', 'g'), ' $1 ');                    // copper(II) → copper ii
  return s.replace(/\s+/g, ' ').trim();
}
var SDS_HYDRATE = /\b(anhydrous|(mono|di|tri|tetra|penta|hexa|hepta|octa|nona|deca|dodeca)?hydrated?|hidrated)\b|-?\s*\d+\s*-?\s*water\b/g;
var SDS_NOISE = /\b(\d+([.,]\d+)?\s*(%|m|mol|vol|volumes?|g|ml|mm)?|agr|iso|fisher|en|fr|pa|extra pure|for analysis|pure|powder|granular|granules|lump|lumps|pellets|chips|ribbon|turnings|metal|solid|solution|aqueous|aq|indicator|reagent|grade|stone|rod|plate|sheet|foil|wire|tablets?|crystals?|cristal|flakes?|red|lyophilized|sodium salt|disodium salt)\b/g;
function sdsKey_(base, relaxed) { var s = base; if (relaxed) s = s.replace(SDS_HYDRATE, ' ').replace(SDS_NOISE, ' '); return s.replace(/[^a-z0-9]/g, ''); }
/** The relaxed words in any order: "starch from potato soluble" = "soluble potato starch". */
function sdsBag_(base) { return sdsWords_(base.replace(SDS_HYDRATE, ' ').replace(SDS_NOISE, ' ')).filter(function (w) { return ['from', 'of', 'and', 'the'].indexOf(w) < 0; }).sort().join(' '); }
/** Every way a name could be written: itself, then with each old/IUPAC synonym swapped. */
function sdsVariants_(name) {
  var out = [], add = function (x) { x = sdsBase_(x); if (x && out.indexOf(x) < 0) out.push(x); };
  add(name);
  for (var k = 0; k < out.length && k < 6; k++) SDS_SYNONYMS.forEach(function (p) {
    [[p[0], p[1]], [p[1], p[0]]].forEach(function (ab) { var a = sdsBase_(ab[0]); if (out[k].indexOf(a) >= 0) add(out[k].replace(a, sdsBase_(ab[1]))); });
  });
  return out;
}
function sdsWords_(s) { return s.replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(String); }
/** Build the index once: files = [{ name, url }]. A file named "methanoic acid, formic acid.pdf" answers to both names. */
function sdsIndex_(files) {
  var idx = { exact: {}, relaxed: {}, bag: {}, all: [] };
  files.forEach(function (f) {
    var names = [f.name].concat(f.name.replace(/\.(pdf|docx?)$/i, '').split(/\s*,\s*/).length > 1 ? f.name.replace(/\.(pdf|docx?)$/i, '').split(/\s*,\s*/) : []);
    names.forEach(function (n) { sdsVariants_(n).forEach(function (v) {
      idx.all.push({ key: sdsKey_(v, true), f: f });
      [['exact', sdsKey_(v)], ['relaxed', sdsKey_(v, true)], ['bag', sdsBag_(v)]].forEach(function (kk) { var b = idx[kk[0]][kk[1]] = idx[kk[0]][kk[1]] || []; if (b.indexOf(f) < 0) b.push(f); });
    }); });
  });
  return idx;
}
/** The best SDS file for a chemical (and its alternative names): { file, exact } or null. Several candidates → most words in common, English first. */
function sdsMatch_(idx, names) {
  var vs = []; names.forEach(function (n) { sdsVariants_(n).forEach(function (v) { if (vs.indexOf(v) < 0) vs.push(v); }); });
  var pick = function (cands) {
    var words = {}; vs.forEach(function (v) { sdsWords_(v).forEach(function (w) { words[w] = 1; }); });
    return cands.map(function (f) { var fw = sdsWords_(sdsBase_(f.name)); var common = fw.filter(function (w) { return words[w]; }).length;
      return { f: f, common: common, ratio: common / Math.max(1, fw.length) - (/\bfr\b/i.test(f.name) ? 0.5 : 0) - (/\.docx?$/i.test(f.name) ? 0.3 : 0) }; })
      .sort(function (a, b) { return b.common - a.common || b.ratio - a.ratio || a.f.name.length - b.f.name.length; })[0].f;
  };
  var ex = [], rx = [];
  vs.forEach(function (v) { (idx.exact[sdsKey_(v)] || []).forEach(function (f) { if (ex.indexOf(f) < 0) ex.push(f); }); });
  if (ex.length) return { file: pick(ex), exact: true };
  vs.forEach(function (v) { var k = sdsKey_(v, true); if (k.length > 2) (idx.relaxed[k] || []).forEach(function (f) { if (rx.indexOf(f) < 0) rx.push(f); }); });
  if (!rx.length) vs.forEach(function (v) { var k = sdsBag_(v); if (k.length > 2) (idx.bag[k] || []).forEach(function (f) { if (rx.indexOf(f) < 0) rx.push(f); }); });
  // last try: the file name is the chemical's name plus a word or two ("dichlorophenolindophenol DCPIP")
  if (!rx.length) vs.forEach(function (v) { var k = sdsKey_(v, true); if (k.length >= 8) idx.all.forEach(function (x) { if (x.key.indexOf(k) === 0 && k.length >= 0.75 * x.key.length && rx.indexOf(x.f) < 0) rx.push(x.f); }); });
  return rx.length ? { file: pick(rx), exact: false } : null;
}

/**
 * Link every chemical in the Inventory to its safety data sheet (SDS) in a Drive folder.
 * Set the SDS_FOLDER_ID script property (or pass the folder ID), then run linkSds. It matches by name — also by the
 * chemical's alternative names (altNames column) and common old/IUPAC names (ethanoic acid = acetic acid …).
 *   exact match  → sds = the file's preview link
 *   close match  → sds = the link, and sdsNote says "Close match — check …" (e.g. a different hydrate or concentration)
 *   no match     → sdsNote = "No SDS found"
 * Chemicals with no file in the folder are looked up in an optional "SDS web links" tab (columns id, chemical, sds, source,
 * productOnSds, note — import data/sds-web-links.csv from the repository): free SDS PDFs from the suppliers' own websites.
 * Links that someone typed in by hand are kept; run linkSds(null, true) to redo every link.
 * The "SDS report" tab lists every chemical with its file, plus the files nothing matched and the near-duplicate files.
 */
function linkSds(folderId, overwrite) {
  folderId = folderId || PropertiesService.getScriptProperties().getProperty('SDS_FOLDER_ID');
  if (!folderId) throw new Error('Set the SDS_FOLDER_ID script property first');
  var files = [], it = DriveApp.getFolderById(folderId).getFiles();
  while (it.hasNext()) { var f = it.next(); if (/\.(pdf|docx?)$/i.test(f.getName())) files.push({ name: f.getName(), url: 'https://drive.google.com/file/d/' + f.getId() + '/preview' }); }
  var idx = sdsIndex_(files), used = {}, report = [], n = { exact: 0, close: 0, none: 0, kept: 0 };
  var auto = function (r) { return !r.sds || /^(Close match|No SDS found)/.test(r.sdsNote || '') || files.some(function (f) { return f.url === r.sds; }); };
  var web = {}, webSheet = SpreadsheetApp.getActive().getSheetByName('SDS web links');
  if (webSheet && webSheet.getLastRow() > 1) {
    var wv = webSheet.getDataRange().getValues(), wh = wv.shift().map(String);
    wv.forEach(function (x) { var o = {}; wh.forEach(function (h, j) { o[h] = x[j]; }); if (!o.sds) return;
      if (o.id) web['id:' + o.id] = o; if (o.chemical) web['name:' + sdsKey_(sdsBase_(o.chemical))] = o; });
  }
  n.web = 0;
  var rows = read_('Inventory');
  rows.forEach(function (r) {
    if (r.list !== 'Chemicals') return;
    if (r.sds && !overwrite && !auto(r)) { n.kept++; report.push([r.id, r.name, '', 'Kept (typed in by hand)', r.sds]); return; }
    var names = [r.name].concat(String(r.altNames || '').split(/\s*[;|]\s*/).filter(String));
    var m = sdsMatch_(idx, names);
    var w = !m && (web['id:' + r.id] || web['name:' + sdsKey_(sdsBase_(r.name))]);
    if (w && (!w.chemical || sdsKey_(sdsBase_(w.chemical)) === sdsKey_(sdsBase_(r.name)))) { // a supplier's SDS from the web
      r.sds = String(w.sds); r.sdsNote = w.note ? 'Close match — check it is the right one: ' + w.note : '';
      n.web++; report.push([r.id, r.name, w.productOnSds || '', 'Web — ' + (w.source || 'supplier'), r.sds]); return; }
    if (!m) { r.sds = ''; r.sdsNote = 'No SDS found'; n.none++; report.push([r.id, r.name, '', 'None', '']); return; }
    used[m.file.url] = 1; r.sds = m.file.url;
    r.sdsNote = m.exact ? '' : 'Close match — check it is the right one: ' + m.file.name.replace(/\.(pdf|docx?)$/i, '');
    n[m.exact ? 'exact' : 'close']++; report.push([r.id, r.name, m.file.name, m.exact ? 'Exact' : 'Close — check', m.file.url]);
  });
  importTable_('Inventory', rows, 'replace', { role: 'admin' });
  // near-duplicate files (same chemical, different file) and files nothing matched
  var groups = {}; files.forEach(function (f) { var k = sdsKey_(sdsBase_(f.name), true); (groups[k] = groups[k] || []).push(f.name); });
  var dups = Object.keys(groups).filter(function (k) { return groups[k].length > 1; }).map(function (k) { return groups[k].join('  +  '); });
  var unused = files.filter(function (f) { return !used[f.url]; }).map(function (f) { return f.name; });
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName('SDS report') || ss.insertSheet('SDS report'); sh.clear();
  var out = [['Chemical id', 'Chemical', 'SDS file', 'Match', 'Link']].concat(report);
  out.push(['', '', '', '', ''], ['Files no chemical matched (' + unused.length + ')', '', '', '', '']); unused.forEach(function (x) { out.push(['', x, '', '', '']); });
  out.push(['', '', '', '', ''], ['Files that look like the same chemical (' + dups.length + ') — keep one', '', '', '', '']); dups.forEach(function (x) { out.push(['', x, '', '', '']); });
  sh.getRange(1, 1, out.length, 5).setValues(out); sh.getRange(1, 1, 1, 5).setFontWeight('bold'); sh.setFrozenRows(1);
  Logger.log('SDS: ' + n.exact + ' exact, ' + n.close + ' close (check), ' + n.web + ' from the web, ' + n.none + ' none, ' + n.kept + ' kept. ' + files.length + ' files, ' + unused.length + ' unused. See the "SDS report" tab.');
}

/**
 * Other names of chemicals (propanone = acetone). Make a tab called "Alternative names" and either import
 * alternative-names.csv into it (columns id, chemical, altNames) or paste the Name and Alternative name(s)
 * columns straight from the inventory spreadsheet. Then run linkAltNames from the editor.
 * Each row is matched by id first, then by name. Names are separated with ";" in the app.
 * Run linkSds afterwards: it also searches the SDS folder by the other names.
 * overwrite = true also replaces names typed in by hand in the app (by default they are kept and the new ones added).
 */
function linkAltNames(overwrite) {
  var sh = SpreadsheetApp.getActive().getSheetByName('Alternative names');
  if (!sh || sh.getLastRow() < 2) throw new Error('Make an "Alternative names" tab with the names first');
  var v = sh.getDataRange().getValues(), head = v.shift().map(function (h) { return String(h).trim().toLowerCase(); });
  var col = function (re) { for (var j = 0; j < head.length; j++) if (re.test(head[j])) return j; return -1; };
  var cId = col(/^id$/), cName = col(/^(chemical|name)$/), cAlt = col(/^(altnames|alternative name|other name)/);
  if (cAlt < 0 || (cId < 0 && cName < 0)) throw new Error('The tab needs an altNames (or "Alternative name(s)") column and an id or name column');
  var rows = read_('Inventory'), byId = {}, byName = {};
  rows.forEach(function (r) { if (r.list !== 'Chemicals') return; byId[r.id] = r; var k = sdsKey_(sdsBase_(r.name)); (byName[k] = byName[k] || []).push(r); });
  var split = function (s) { return String(s || '').replace(/[\t\r\n"]+/g, ' ').split(/\s*;\s*|,\s+|\s+\/\s+|\s+or\s+/).map(function (x) { return x.replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, ''); }).filter(function (x) { return x && !/^\(.*\)$/.test(x); }); };
  var n = { set: 0, none: [] };
  v.forEach(function (x) {
    var alt = split(x[cAlt]); if (!alt.length) return;
    var hits = cId >= 0 && byId[String(x[cId]).trim()] ? [byId[String(x[cId]).trim()]] : cName >= 0 ? byName[sdsKey_(sdsBase_(String(x[cName])))] || [] : [];
    if (!hits.length) { n.none.push(String(cName >= 0 ? x[cName] : x[cId])); return; }
    hits.forEach(function (r) {
      var have = overwrite ? [] : split(String(r.altNames || '').replace(/\|/g, ';'));
      alt.forEach(function (a) { if (have.map(function (h) { return h.toLowerCase(); }).indexOf(a.toLowerCase()) < 0) have.push(a); });
      r.altNames = have.join('; '); n.set++;
    });
  });
  importTable_('Inventory', rows, 'replace', { role: 'admin' });
  Logger.log('Other names added to ' + n.set + ' chemicals.' + (n.none.length ? ' Not found in the inventory (' + n.none.length + '): ' + n.none.join(', ') : ''));
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
