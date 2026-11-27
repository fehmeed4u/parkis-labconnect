/**
 * Practical library — Google Drive scanner (standalone Apps Script project).
 *
 * Walks every Drive the signed-in account can see (My Drive, "Shared with me" and all
 * shared drives), finds practical / lab files for Grade 11 and Grade 12 (IB DP or A Level),
 * reads the text of each one and writes ONE JSON file you can upload to the Practicals app.
 *
 * HOW TO RUN
 *   1. Go to https://script.google.com → New project. Name it "Practical library scan".
 *   2. Paste this file into Code.gs. Project Settings → tick "Show appsscript.json",
 *      then paste appsscript.json from the same folder (it switches on the Drive API, v3).
 *   3. Optional: edit CONFIG below (e.g. limit the scan to a few top folders).
 *   4. Select startScan in the toolbar → Run → allow the permissions.
 *   5. Apps Script stops a run after 6 minutes, so the scan saves its progress and carries on by
 *      itself every minute until it's done. You get an email with the link when it's
 *      finished. You can also run scanStatus() at any time to see how far it has got.
 *   6. Download "practicals-grade11-12.json" from the Drive folder "Practical Library Export"
 *      and upload it to the app (or hand it to Claude).
 *
 * Other functions: scanStatus() shows progress · stopScan() stops the scan and keeps the
 * progress · resetScan() clears the progress so the next startScan() starts again ·
 * buildOutputNow() writes the JSON from whatever has been read so far.
 */

var CONFIG = {
  OUTPUT_FOLDER_NAME: 'Practical Library Export',
  OUTPUT_FILE_NAME: 'practicals-grade11-12.json',

  // Leave empty to scan everything. Or put folder IDs here (the part after /folders/ in the
  // URL) to scan only those folders and the folders inside them.
  ROOT_FOLDER_IDS: [],

  // The app uses Grade 11 and Grade 12. British "Year 12" = Grade 11, "Year 13" = Grade 12.
  // If your folders say "Year 11 / Year 12" and mean Grade 11 / Grade 12, set this to 0.
  YEAR_TO_GRADE_OFFSET: -1,

  // A file is kept only if its name or one of its folders sounds like a practical
  // (practical, lab, experiment, investigation, required practical, PAG, CPAC, IA…).
  REQUIRE_PRACTICAL_WORD: true,

  // Keep files that are clearly IB or A Level but don't say which grade (grade = null).
  INCLUDE_UNKNOWN_GRADE: true,

  // Skip student work: Google Classroom hand-ins and folders named like the ones below.
  EXCLUDE_CLASSROOM_FOLDER: true,
  EXCLUDE_RE: /\b(student\s*(work|submissions?|reports?|ia)|submissions?|hand\s*ins?|marked|graded|portfolios?|mark\s*schemes?|exam\s*papers?|past\s*papers?)\b/i,

  // Reading the text: Google Docs, Slides and Sheets are read directly. Word, PowerPoint
  // and PDF files are copied to a temporary Google Doc, read, then the copy is deleted.
  EXTRACT_TEXT: true,
  CONVERT_OFFICE_AND_PDF: true,
  MAX_CONVERSIONS: 600,     // upper limit for Word/PDF/PowerPoint conversions
  MAX_EXCERPT_CHARS: 5000,  // text kept per file (the JSON stays small enough to upload)

  NOTIFY_BY_EMAIL: true,
  MAX_RUN_MS: 4.6 * 60 * 1000
};

/* ---------------------------------------------------------------- patterns */

var MIME = {
  FOLDER: 'application/vnd.google-apps.folder',
  GDOC: 'application/vnd.google-apps.document',
  GSLIDES: 'application/vnd.google-apps.presentation',
  GSHEET: 'application/vnd.google-apps.spreadsheet',
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  DOC: 'application/msword',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  PPT: 'application/vnd.ms-powerpoint',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  RTF: 'application/rtf',
  TXT: 'text/plain'
};
var WANTED_MIME = [MIME.GDOC, MIME.GSLIDES, MIME.GSHEET, MIME.PDF, MIME.DOCX, MIME.DOC, MIME.PPTX, MIME.PPT, MIME.XLSX, MIME.RTF, MIME.TXT];
var TYPE_LABEL = {};
TYPE_LABEL[MIME.GDOC] = 'Google Doc'; TYPE_LABEL[MIME.GSLIDES] = 'Google Slides'; TYPE_LABEL[MIME.GSHEET] = 'Google Sheet';
TYPE_LABEL[MIME.PDF] = 'PDF'; TYPE_LABEL[MIME.DOCX] = 'Word'; TYPE_LABEL[MIME.DOC] = 'Word'; TYPE_LABEL[MIME.PPTX] = 'PowerPoint';
TYPE_LABEL[MIME.PPT] = 'PowerPoint'; TYPE_LABEL[MIME.XLSX] = 'Excel'; TYPE_LABEL[MIME.RTF] = 'Rich text'; TYPE_LABEL[MIME.TXT] = 'Text';

var PRACTICAL_RE = /practicals?|\bpracs?\b|\blabs?\b|laborator|experiment|investigation|\bpags?\s*\d*\b|\bcpac\b|required\s+practical|core\s+practical|\brp\s*\d+\b|lab\s*(sheet|book|manual)|tech(nician)?\s*(sheet|notes|requirements?)|practical\s*booklet|\bprep\s*sheet/i;

var IB_RE = /\bib\s*(dp)?\b|\bibdp\b|\bdp\s*[12]?\b|diploma\s+programme|\b(hl|sl)\b|internal\s+assessment|\bib\s*[12]\b/i;
var AL_RE = /\ba\s*-?\s*levels?\b|\balevels?\b|\bcaie\b|\bcie\b|cambridge\s+international\s+as|\b970[0-2]\b|\b9093\b|\bedexcel\b|\baqa\b|\bocr\b|\bcpac\b|\bpags?\s*\d+\b|\bwjec\b/i;
var AL_CASE_RE = /\bAS\b|\bA2\b/; // case-sensitive: "AS" / "A2" in capitals only
var LOWER_COURSE_RE = /\bi?gcse\b|\bmyp\b|\bks\s*[1-4]\b|key\s*stage|middle\s*school|checkpoint|lower\s*secondary/i;

var SUBJECTS = [
  ['Biology', /\bbio(logy)?\b/i],
  ['Chemistry', /\bchem(istry)?\b/i],
  ['Physics', /\bphys(ics)?\b/i],
  ['Environmental Systems and Societies', /\bess\b|environmental\s+systems/i],
  ['Sports, Exercise and Health Science', /\bsehs\b|sports?,?\s*exercise/i],
  ['Marine Science', /marine\s+science/i],
  ['Environmental Management', /environmental\s+management/i],
  ['Design Technology', /design\s*(and\s*)?tech/i],
  ['Psychology', /psycholog/i],
  ['Science', /\bscience\b/i]
];

var HEADINGS = [
  ['aim', /^(aims?|objectives?|purpose|goals?|research\s+question|learning\s+objectives?|intro(duction)?)\b/i],
  ['equipment', /^(equipment|apparatus|materials?|requirements?|chemicals|reagents|solutions|you\s+will\s+need|resources|kit|technician('?s)?\s*(notes|requirements|sheet)?|per\s+(group|pair|student|bench)|list\s+of\s+(equipment|materials|apparatus)|items?\s+needed|what\s+you\s+need)\b/i],
  ['method', /^(method|procedure|instructions|steps|what\s+to\s+do|experimental\s+(method|procedure)|practical\s+procedure)\b/i],
  ['safety', /^(safety|risk(s|\s+assessment)?|hazards?|precautions|health\s+(and|&)\s+safety|cleapss)\b/i],
  ['variables', /^(variables|independent\s+variable|dependent\s+variable|control(led)?\s+variables?)\b/i],
  ['other', /^(results|analysis|conclusion|evaluation|questions|data|discussion|extension|background|theory|hypothesis|prediction|references|bibliography|assessment|marking|mark\s+scheme|answers?)\b/i]
];

/* ---------------------------------------------------------------- entry points */

function startScan() {
  var st = loadState_();
  if (st && st.phase !== 'done') {
    Logger.log('A scan is already in progress (phase: ' + st.phase + '). Continuing it. Run resetScan() first to start again.');
  } else {
    st = newState_();
    saveState_(st);
    Logger.log('New scan started.');
  }
  continueScan();
}

function continueScan() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { Logger.log('Another run is still working — this one stops.'); return; }
  var t0 = Date.now();
  try {
    clearTriggers_();
    var st = loadState_();
    if (!st) { Logger.log('No scan in progress. Run startScan().'); return; }
    // safety net: if this run is cut off by Google's 6-minute limit, the scan still carries on
    ScriptApp.newTrigger('continueScan').timeBased().after(8 * 60 * 1000).create();
    var timeLeft = function () { return Date.now() - t0 < CONFIG.MAX_RUN_MS; };

    if (st.phase === 'folders') scanFolders_(st, timeLeft);
    if (st.phase === 'files' && timeLeft()) scanFiles_(st, timeLeft);
    if (st.phase === 'extract' && timeLeft()) extractAll_(st, timeLeft);
    if (st.phase === 'write' && timeLeft()) { writeOutput_(st); }

    saveState_(st);
    PropertiesService.getScriptProperties().deleteProperty('failCount');
    clearTriggers_();
    if (st.phase !== 'done') {
      ScriptApp.newTrigger('continueScan').timeBased().after(60 * 1000).create();
      Logger.log(statusLine_(st) + ' — next part starts in about a minute.');
    } else {
      Logger.log('Finished. ' + statusLine_(st) + '\nJSON: ' + st.outputUrl);
    }
  } catch (e) {
    Logger.log('Error: ' + (e && e.stack || e));
    clearTriggers_();
    var props = PropertiesService.getScriptProperties();
    var fails = Number(props.getProperty('failCount') || 0) + 1;
    props.setProperty('failCount', String(fails));
    if (fails < 5) ScriptApp.newTrigger('continueScan').timeBased().after(2 * 60 * 1000).create();
    else Logger.log('Stopped after 5 failed runs in a row. Fix the error above, then run startScan() to carry on.');
  } finally {
    lock.releaseLock();
  }
}

function scanStatus() {
  var st = loadState_();
  Logger.log(st ? statusLine_(st) + (st.outputUrl ? '\nJSON: ' + st.outputUrl : '') : 'No scan yet. Run startScan().');
}

function stopScan() { clearTriggers_(); Logger.log('Stopped. Progress is kept: run startScan() to carry on.'); }

function resetScan() {
  clearTriggers_();
  var f = stateFile_(false);
  if (f) f.setTrashed(true);
  Logger.log('Progress cleared. Run startScan() to start again.');
}

/** Writes the JSON now from whatever has been read so far (useful if you can't wait). */
function buildOutputNow() {
  var st = loadState_();
  if (!st || !st.candidates) { Logger.log('Nothing found yet.'); return; }
  writeOutput_(st, true);
  saveState_(st);
  Logger.log('Partial JSON written: ' + st.outputUrl);
}

/* ---------------------------------------------------------------- phase 1: folders */

function scanFolders_(st, timeLeft) {
  do {
    var res = Drive.Files.list({
      q: "mimeType='" + MIME.FOLDER + "' and trashed=false",
      corpora: 'allDrives', includeItemsFromAllDrives: true, supportsAllDrives: true,
      pageSize: 1000, pageToken: st.pageToken || undefined,
      fields: 'nextPageToken, incompleteSearch, files(id,name,parents,driveId)'
    });
    (res.files || []).forEach(function (f) { st.folders[f.id] = [f.name, (f.parents || [])[0] || '', f.driveId || '']; });
    if (res.incompleteSearch) st.incompleteSearch = true;
    st.pageToken = res.nextPageToken || '';
  } while (st.pageToken && timeLeft());

  if (!st.pageToken) {
    st.phase = 'files';
    st.stats.folders = Object.keys(st.folders).length;
    // names of the shared drives, so paths start with the drive's name
    try {
      var tok = null;
      do {
        var d = Drive.Drives.list({ pageSize: 100, pageToken: tok || undefined, fields: 'nextPageToken, drives(id,name)' });
        (d.drives || []).forEach(function (x) { st.drives[x.id] = x.name; });
        tok = d.nextPageToken;
      } while (tok);
    } catch (e) { /* no shared drives, or not allowed — fine */ }
  }
}

/* ---------------------------------------------------------------- phase 2: files */

function scanFiles_(st, timeLeft) {
  var mimeQ = WANTED_MIME.map(function (m) { return "mimeType='" + m + "'"; }).join(' or ');
  do {
    var res = Drive.Files.list({
      q: 'trashed=false and (' + mimeQ + ')',
      corpora: 'allDrives', includeItemsFromAllDrives: true, supportsAllDrives: true,
      pageSize: 1000, pageToken: st.pageToken || undefined,
      fields: 'nextPageToken, incompleteSearch, files(id,name,mimeType,parents,driveId,webViewLink,modifiedTime,createdTime,size,md5Checksum)'
    });
    (res.files || []).forEach(function (f) {
      st.stats.files++;
      var c = classify_(st, f);
      if (c) st.candidates.push(c);
    });
    if (res.incompleteSearch) st.incompleteSearch = true;
    st.pageToken = res.nextPageToken || '';
  } while (st.pageToken && timeLeft());

  if (!st.pageToken) {
    markDuplicates_(st.candidates);
    st.phase = CONFIG.EXTRACT_TEXT ? 'extract' : 'write';
    st.next = 0;
  }
}

function classify_(st, f) {
  if (st.outputFolderId && f.parents && f.parents[0] === st.outputFolderId) return null;
  var chain = folderChain_(st, (f.parents || [])[0], f.driveId);
  if (chain.skip) return null;
  if (CONFIG.ROOT_FOLDER_IDS.length && !chain.ids.some(function (id) { return CONFIG.ROOT_FOLDER_IDS.indexOf(id) >= 0; })) return null;

  var baseName = f.name.replace(/\.[a-z0-9]{2,5}$/i, '');
  // look at the file name first, then the nearest folder, then further up
  var parts = [baseName].concat(chain.names.slice().reverse());
  var norm = parts.map(norm_);
  var all = norm.join(' / ');

  if (CONFIG.EXCLUDE_RE && CONFIG.EXCLUDE_RE.test(all)) return null;
  if (CONFIG.EXCLUDE_CLASSROOM_FOLDER && chain.names[0] === 'My Drive' && /^classroom$/i.test(chain.names[1] || '')) return null;
  var isPractical = PRACTICAL_RE.test(all);
  if (CONFIG.REQUIRE_PRACTICAL_WORD && !isPractical) return null;

  var g = detectGrade_(parts, norm, IB_RE.test(all));
  var course = detectCourse_(parts, norm);
  if (g.lower) return null;                      // clearly Grade 6–10 / Year 7–11
  if (!course.course && LOWER_COURSE_RE.test(all)) return null;  // IGCSE / MYP / KS3 …

  var keep = (g.grade === 11 || g.grade === 12) || (course.course && CONFIG.INCLUDE_UNKNOWN_GRADE);
  if (!keep) return null;

  var subj = detectSubject_(norm);
  return {
    driveFileId: f.id,
    fileName: f.name,
    titleGuess: tidyTitle_(baseName),
    url: f.webViewLink || ('https://drive.google.com/open?id=' + f.id),
    mimeType: f.mimeType,
    fileType: TYPE_LABEL[f.mimeType] || f.mimeType,
    sizeBytes: f.size ? Number(f.size) : null,
    md5: f.md5Checksum || null,
    created: f.createdTime, modified: f.modifiedTime,
    path: chain.names.join(' / '),
    grade: g.grade || null,
    gradeEvidence: g.evidence || null,
    course: course.course || null,
    courseEvidence: course.evidence || null,
    subject: subj.subject || null,
    subjectEvidence: subj.evidence || null,
    topicGuess: topicGuess_(chain.names),
    extract: 'pending'
  };
}

function detectGrade_(parts, norm, isIB) {
  var off = CONFIG.YEAR_TO_GRADE_OFFSET;
  for (var i = 0; i < norm.length; i++) {
    var s = norm[i], raw = parts[i], m, h;
    if ((m = s.match(/\b(?:dp|ib|ibdp)\s*(?:year|yr|y)?\s*([12])\b/))) return { grade: 10 + Number(m[1]), evidence: raw };
    if ((m = s.match(/\b(?:grade|grd|gr|g)\s*\.?\s*(\d{1,2})\b/)) && (h = gradeHit_(Number(m[1]), raw))) return h;
    if ((m = s.match(/\b(1[12])\s*(?:th)?\s*(?:grade|gr)\b/))) return { grade: Number(m[1]), evidence: raw };
    if ((m = s.match(/\b(?:year|yr|y)\s*\.?\s*(\d{1,2})\b/))) {
      var y = Number(m[1]);
      if (isIB && (y === 1 || y === 2)) return { grade: 10 + y, evidence: raw }; // "IB Chemistry / Year 1"
      if ((h = gradeHit_(y + off, raw))) return h;
    }
    if (/\bas\s*level\b/.test(s) || /\bAS\b/.test(raw) || /\blower\s*sixth\b|\bl 6\b/.test(s)) return { grade: 11, evidence: raw };
    if (/\ba 2\s*level\b/.test(s) || /\bA2\b/.test(raw) || /\bupper\s*sixth\b|\bu 6\b/.test(s)) return { grade: 12, evidence: raw };
    if (isIB && /\bfirst\s+year\b/.test(s)) return { grade: 11, evidence: raw };
    if (isIB && /\bsecond\s+year\b/.test(s)) return { grade: 12, evidence: raw };
  }
  return {};
}
function gradeHit_(n, raw) {
  if (n === 11 || n === 12) return { grade: n, evidence: raw };
  if (n >= 1 && n <= 10) return { lower: true, evidence: raw };
  return null; // e.g. "g13" or a stray number — ignore and keep looking
}

function detectCourse_(parts, norm) {
  for (var i = 0; i < norm.length; i++) {
    var ib = IB_RE.test(norm[i]), al = AL_RE.test(norm[i]) || AL_CASE_RE.test(parts[i]);
    if (ib && !al) return { course: 'IB', evidence: parts[i] };
    if (al && !ib) return { course: 'A Level', evidence: parts[i] };
    if (ib && al) return { course: 'IB / A Level', evidence: parts[i] };
  }
  return {};
}

function detectSubject_(norm) {
  for (var i = 0; i < norm.length; i++) {
    for (var j = 0; j < SUBJECTS.length; j++) if (SUBJECTS[j][1].test(norm[i])) return { subject: SUBJECTS[j][0], evidence: norm[i] };
  }
  return {};
}

/** The nearest folder whose name isn't just a grade, course, subject or "practicals". */
function topicGuess_(names) {
  var generic = /^(required|core|dept|depts|department|faculty|science\s+dept|teachers?|staff|practicals?|pracs?|labs?|experiments?|investigations?|required\s+practicals?|core\s+practicals?|worksheets?|resources?|docs?|documents?|files?|teaching|curriculum|science|sciences?|department|shared|my\s*drive|archive|old|new|misc|other|\d{4}([-\/]\d{2,4})?|term\s*\d|sem(ester)?\s*\d|unit\s*\d+)$/i;
  for (var i = names.length - 1; i >= 0; i--) {
    var n = norm_(names[i]);
    var stripped = n.replace(/\b(grade|year|gr|yr|g|y)\s*\d{1,2}\b|\b(ib|dp|ibdp|hl|sl|a\s*-?\s*level|as|a2|cie|caie|aqa|ocr|edexcel)\b|\b(biology|chemistry|physics|bio|chem|phys|science)\b|\b(practicals?|labs?)\b/gi, '').replace(/[\s\-_.,:&]+/g, ' ').trim();
    if (stripped.length >= 3 && !generic.test(stripped)) return names[i];
  }
  return null;
}

function folderChain_(st, parentId, driveId) {
  var names = [], ids = [], guard = 0, id = parentId;
  while (id && guard++ < 40) {
    var f = st.folders[id];
    if (!f) {
      if (st.drives[id]) names.push(st.drives[id]);
      else if (id === st.rootId) names.push('My Drive');
      else names.push('(Shared with me)');
      ids.push(id);
      break;
    }
    ids.push(id);
    names.push(f[0]);
    if (st.outputFolderId && id === st.outputFolderId) return { skip: true };
    id = f[1];
  }
  if (!parentId) names.push(driveId && st.drives[driveId] ? st.drives[driveId] : '(Shared with me)');
  return { names: names.reverse(), ids: ids };
}

function markDuplicates_(list) {
  var seen = {};
  list.forEach(function (c) {
    var key = c.md5 ? 'md5:' + c.md5 : 'name:' + c.fileName.toLowerCase() + '|' + (c.sizeBytes || '');
    if (seen[key]) c.duplicateOf = seen[key]; else seen[key] = c.driveFileId;
  });
}

/* ---------------------------------------------------------------- phase 3: read text */

function extractAll_(st, timeLeft) {
  while (st.next < st.candidates.length && timeLeft()) {
    var c = st.candidates[st.next];
    try {
      if (c.duplicateOf) { c.extract = 'skipped: duplicate'; }
      else {
        var text = readText_(st, c);
        if (text === null) { if (c.extract === 'pending') c.extract = 'skipped'; }
        else {
          var parsed = parseSections_(text);
          c.firstLine = parsed.firstLine;
          c.sections = parsed.sections;
          c.hazcards = parsed.hazcards;
          c.prepMinutesGuess = parsed.prepMinutes;
          c.excerpt = text.slice(0, CONFIG.MAX_EXCERPT_CHARS);
          c.textLength = text.length;
          c.extract = 'ok';
          st.stats.textRead++;
          // a heading inside the document beats a guess from the folders
          if (!c.grade) { var g = detectGrade_([parsed.head], [norm_(parsed.head)], c.course === 'IB'); if (g.grade) { c.grade = g.grade; c.gradeEvidence = 'document: ' + g.evidence.slice(0, 80); } }
          if (!c.course) { var co = detectCourse_([parsed.head], [norm_(parsed.head)]); if (co.course) { c.course = co.course; c.courseEvidence = 'document'; } }
          if (!c.subject) { var su = detectSubject_([norm_(parsed.head)]); if (su.subject) { c.subject = su.subject; c.subjectEvidence = 'document'; } }
        }
      }
    } catch (e) {
      c.extract = 'error: ' + String(e && e.message || e).slice(0, 200);
      st.stats.errors++;
    }
    st.next++;
  }
  if (st.next >= st.candidates.length) st.phase = 'write';
}

function readText_(st, c) {
  var m = c.mimeType;
  if (m === MIME.GDOC || m === MIME.GSLIDES) return exportText_(c.driveFileId, 'text/plain');
  if (m === MIME.GSHEET) return exportText_(c.driveFileId, 'text/csv');
  if (m === MIME.TXT) return DriveApp.getFileById(c.driveFileId).getBlob().getDataAsString();
  if (!CONFIG.CONVERT_OFFICE_AND_PDF) { c.extract = 'skipped: conversion off'; return null; }
  if (st.stats.conversions >= CONFIG.MAX_CONVERSIONS) { c.extract = 'skipped: conversion limit'; return null; }
  var target = (m === MIME.PPTX || m === MIME.PPT) ? MIME.GSLIDES : (m === MIME.XLSX ? MIME.GSHEET : MIME.GDOC);
  st.stats.conversions++;
  var copy = Drive.Files.copy({ name: '_tmp_scan_' + c.driveFileId, mimeType: target, parents: [tmpFolderId_(st)] }, c.driveFileId, { supportsAllDrives: true, fields: 'id' });
  try {
    return exportText_(copy.id, target === MIME.GSHEET ? 'text/csv' : 'text/plain');
  } finally {
    try { Drive.Files.remove(copy.id, { supportsAllDrives: true }); }
    catch (e) { try { DriveApp.getFileById(copy.id).setTrashed(true); } catch (e2) {} }
  }
}

function exportText_(fileId, mime) {
  var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/export?mimeType=' + encodeURIComponent(mime);
  for (var attempt = 0; attempt < 3; attempt++) {
    var r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    var code = r.getResponseCode();
    if (code === 200) return r.getContentText('UTF-8');
    if (code === 429 || code >= 500) { Utilities.sleep(1500 * (attempt + 1)); continue; }
    throw new Error('export ' + code + ': ' + r.getContentText().slice(0, 150));
  }
  throw new Error('export failed after retries');
}

/** Splits the text under headings like Aim / Equipment / Method / Safety. */
function parseSections_(text) {
  var lines = text.replace(/\r/g, '').split('\n').map(function (l) { return l.replace(/ /g, ' ').trim(); });
  var sections = { aim: [], equipment: [], method: [], safety: [], variables: [] };
  var cur = null, firstLine = '';
  lines.forEach(function (line) {
    if (!line) return;
    if (!firstLine && line.length > 2) firstLine = line.slice(0, 150);
    var clean = line.replace(/^[\s\d.)\-•*–#]+/, '').trim();
    var hit = null;
    if (clean.length <= 70) {
      for (var i = 0; i < HEADINGS.length; i++) if (HEADINGS[i][1].test(clean)) { hit = HEADINGS[i][0]; break; }
    }
    if (hit) {
      cur = hit;
      var rest = clean.split(/[:\-–]\s*/).slice(1).join(': ').trim(); // "Equipment: beaker, …"
      if (rest && sections[cur]) sections[cur].push(rest);
      return;
    }
    if (cur && sections[cur]) sections[cur].push(line);
  });
  var cap = { aim: 8, equipment: 80, method: 60, safety: 25, variables: 15 };
  var out = {};
  Object.keys(sections).forEach(function (k) {
    var arr = sections[k].slice(0, cap[k]).map(function (s) { return s.slice(0, 300); });
    if (arr.length) out[k] = k === 'equipment' ? arr : arr.join('\n');
  });

  var haz = {}, m, re = /hazcards?\s*(?:no\.?|number|#)?\s*:?\s*((?:\d{1,3}[a-z]?\s*(?:,|and|&|\/)?\s*)+)/gi;
  while ((m = re.exec(text))) m[1].split(/[^0-9a-z]+/i).forEach(function (x) { if (/^\d{1,3}[a-z]?$/i.test(x)) haz[x.toUpperCase()] = 1; });
  var prep = text.match(/prep(?:aration)?\s*time\s*:?\s*(\d{1,3})\s*(min|minutes|mins|h|hours?)/i);
  var prepMinutes = prep ? Number(prep[1]) * (/^h/i.test(prep[2]) ? 60 : 1) : null;

  return { firstLine: firstLine, sections: out, hazcards: Object.keys(haz), prepMinutes: prepMinutes, head: lines.slice(0, 15).join(' ') };
}

/* ---------------------------------------------------------------- phase 4: write JSON */

function writeOutput_(st, partial) {
  var list = st.candidates;
  var practicals = list.map(function (c, i) {
    var kit = (c.sections && c.sections.equipment || []).map(function (line) {
      var q = line.match(/^(\d+(?:\.\d+)?)\s*(?:x|×)?\s+(.+)$/i);
      return q ? { name: q[2].trim(), perGroup: Number(q[1]) } : { name: line, perGroup: 1 };
    }).filter(function (k) { return k.name.length > 1 && k.name.length < 160; });
    return {
      // fields of the app's Library table
      id: 'drv-' + c.driveFileId,
      title: bestTitle_(c),
      grade: c.grade,
      subject: c.subject,
      course: c.course,
      topic: c.topicGuess,
      kit: kit,
      prepMinutes: c.prepMinutesGuess || null,
      method: c.url,
      // where it came from and why it was picked — so it can be checked before import
      source: {
        driveFileId: c.driveFileId, fileName: c.fileName, fileType: c.fileType, path: c.path,
        modified: c.modified, created: c.created, duplicateOf: c.duplicateOf ? 'drv-' + c.duplicateOf : null,
        gradeEvidence: c.gradeEvidence, courseEvidence: c.courseEvidence, subjectEvidence: c.subjectEvidence,
        extract: c.extract
      },
      content: c.extract === 'ok' ? {
        aim: c.sections.aim || null, equipment: c.sections.equipment || [], method: c.sections.method || null,
        safety: c.sections.safety || null, variables: c.sections.variables || null,
        hazcards: c.hazcards || [], textLength: c.textLength, excerpt: c.excerpt
      } : null
    };
  });
  practicals.sort(function (a, b) {
    return String(a.grade || 99).localeCompare(String(b.grade || 99)) || String(a.course).localeCompare(String(b.course)) ||
      String(a.subject).localeCompare(String(b.subject)) || String(a.topic).localeCompare(String(b.topic)) || a.title.localeCompare(b.title);
  });

  var count = function (key) { var o = {}; practicals.forEach(function (p) { var k = p[key] == null ? 'unknown' : String(p[key]); o[k] = (o[k] || 0) + 1; }); return o; };
  var out = {
    kind: 'practical-library-scan',
    version: 1,
    generatedAt: new Date().toISOString(),
    complete: !partial,
    notes: [
      'grade/course/subject come from folder and file names (see source.*Evidence).',
      'kit is taken from the Equipment/Apparatus section of each file; check quantities before import.',
      'source.duplicateOf marks the same file stored in another folder.'
    ],
    settings: { yearToGradeOffset: CONFIG.YEAR_TO_GRADE_OFFSET, requirePracticalWord: CONFIG.REQUIRE_PRACTICAL_WORD, includeUnknownGrade: CONFIG.INCLUDE_UNKNOWN_GRADE, rootFolderIds: CONFIG.ROOT_FOLDER_IDS },
    stats: {
      foldersScanned: st.stats.folders, filesScanned: st.stats.files, practicalsFound: practicals.length,
      textRead: st.stats.textRead, conversions: st.stats.conversions, errors: st.stats.errors,
      duplicates: practicals.filter(function (p) { return p.source.duplicateOf; }).length,
      driveSearchIncomplete: !!st.incompleteSearch,
      byGrade: count('grade'), byCourse: count('course'), bySubject: count('subject')
    },
    practicals: practicals
  };

  var folder = outputFolder_(st);
  var name = partial ? CONFIG.OUTPUT_FILE_NAME.replace(/\.json$/, '-partial.json') : CONFIG.OUTPUT_FILE_NAME;
  var old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  var file = folder.createFile(name, JSON.stringify(out, null, 1), 'application/json');
  st.outputUrl = file.getUrl();
  if (partial) return;

  st.phase = 'done';
  try { var tmp = DriveApp.getFolderById(st.tmpFolderId); tmp.setTrashed(true); } catch (e) {}
  st.folders = {}; // free up the state file
  if (CONFIG.NOTIFY_BY_EMAIL) {
    try {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Practical library scan finished',
        practicals.length + ' practicals found (Grade 11–12, IB / A Level) in ' + st.stats.files + ' files.\n\n' +
        'By grade: ' + JSON.stringify(out.stats.byGrade) + '\nBy subject: ' + JSON.stringify(out.stats.bySubject) +
        '\n\nDownload the JSON: ' + st.outputUrl);
    } catch (e) {}
  }
}

/* ---------------------------------------------------------------- helpers */

function bestTitle_(c) {
  var t = c.titleGuess;
  var fl = c.firstLine && tidyTitle_(c.firstLine);
  // use the document's first line when the file name is vague ("Practical 3", "Worksheet")
  if (fl && fl.length >= 6 && fl.length <= 90 && (/^(practical|prac|lab|experiment|worksheet|untitled|copy of)?\s*\d*$/i.test(t) || t.length < 6)) return fl;
  return t || fl || c.fileName;
}
function tidyTitle_(s) {
  return String(s).replace(/^copy of\s+/i, '').replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s\-–:.]+|[\s\-–:.]+$/g, '').trim();
}
function norm_(s) { return String(s || '').replace(/[_\-–.]+/g, ' ').replace(/([a-z])(\d)/gi, '$1 $2').replace(/\s+/g, ' ').toLowerCase(); }

function newState_() {
  var out = outputFolder_({});
  return {
    phase: 'folders', startedAt: new Date().toISOString(), pageToken: '',
    rootId: DriveApp.getRootFolder().getId(), outputFolderId: out.getId(), tmpFolderId: '',
    folders: {}, drives: {}, candidates: [], next: 0, incompleteSearch: false,
    stats: { folders: 0, files: 0, textRead: 0, conversions: 0, errors: 0 }
  };
}

function statusLine_(st) {
  var s = st.stats;
  var where = { folders: 'listing folders (' + Object.keys(st.folders || {}).length + ' so far)', files: 'checking files (' + s.files + ' checked, ' + st.candidates.length + ' practicals so far)', extract: 'reading files (' + st.next + ' of ' + st.candidates.length + ')', write: 'writing the JSON', done: 'done' }[st.phase];
  return 'Scan: ' + where + '. Text read: ' + s.textRead + ', conversions: ' + s.conversions + ', errors: ' + s.errors + '.';
}

function outputFolder_(st) {
  if (st && st.outputFolderId) { try { return DriveApp.getFolderById(st.outputFolderId); } catch (e) {} }
  var it = DriveApp.getRootFolder().getFoldersByName(CONFIG.OUTPUT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(CONFIG.OUTPUT_FOLDER_NAME);
}
function tmpFolderId_(st) {
  if (st.tmpFolderId) { try { if (!DriveApp.getFolderById(st.tmpFolderId).isTrashed()) return st.tmpFolderId; } catch (e) {} }
  st.tmpFolderId = outputFolder_(st).createFolder('_tmp (deleted when the scan ends)').getId();
  return st.tmpFolderId;
}

function stateFile_(create) {
  var folder = outputFolder_({});
  var it = folder.getFilesByName('_scan-progress.json');
  if (it.hasNext()) return it.next();
  return create ? folder.createFile('_scan-progress.json', '{}', 'application/json') : null;
}
function loadState_() {
  var f = stateFile_(false);
  if (!f) return null;
  try { var s = JSON.parse(f.getBlob().getDataAsString()); return s && s.phase ? s : null; } catch (e) { return null; }
}
function saveState_(st) { stateFile_(true).setContent(JSON.stringify(st)); }

function clearTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'continueScan') ScriptApp.deleteTrigger(t); });
}
