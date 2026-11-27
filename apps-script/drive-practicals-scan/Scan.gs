/**
 * Practical library — Google Drive scanner (standalone Apps Script project).
 *
 * Scans ONE Google Drive folder (and every folder inside it), finds practical / lab files
 * for every grade (KS3, IGCSE, A Level, IB…), reads the text of each one and writes ONE
 * JSON file you can upload to the Practicals app. Nothing outside that folder is touched.
 *
 * HOW TO RUN
 *   1. Go to https://script.google.com → New project. Name it "Practical library scan".
 *   2. Paste this file into Code.gs. Project Settings → tick "Show appsscript.json",
 *      then paste appsscript.json from the same folder (it switches on the Drive API, v3).
 *   3. Put your folder's ID in CONFIG.FOLDER_ID below. Open the folder in Drive: the ID is the
 *      part of the address after /folders/  (you can also paste the whole link).
 *   4. Select startScan in the toolbar → Run → allow the permissions.
 *   5. Apps Script stops a run after 6 minutes, so the scan saves its progress and carries on by
 *      itself every minute until it's done. You get an email with the link when it's
 *      finished. You can also run scanStatus() at any time to see how far it has got.
 *   6. Download "practicals-all-grades.json" from the Drive folder "Practical Library Export"
 *      and upload it to the app (or hand it to Claude).
 *
 * Other functions: scanStatus() shows progress · stopScan() stops the scan and keeps the
 * progress · resetScan() clears the progress so the next startScan() starts again ·
 * buildOutputNow() writes the JSON from whatever has been read so far.
 */

var CONFIG = {
  OUTPUT_FOLDER_NAME: 'Practical Library Export',
  OUTPUT_FILE_NAME: 'practicals-all-grades.json',

  // Which grades to keep. 'all' keeps every practical (also ones whose grade can't be worked out,
  // with grades: []). Or a list, e.g. [11, 12] — then files with an unknown grade are kept only
  // if INCLUDE_UNKNOWN_GRADE is true.
  GRADES: 'all',

  // The folder to scan (it and all its subfolders). The ID is the part after /folders/ in the
  // folder's address, e.g. https://drive.google.com/drive/folders/1AbCdEfGh...  → '1AbCdEfGh...'
  // Pasting the whole link also works.
  FOLDER_ID: 'PASTE_FOLDER_ID_HERE',

  // Grades are taken from names like "Grade 8", "Grade 9 & 10", "Key Stage 4 (9 - 10)", "DP1".
  // A British "Year 12" = Grade 11. If your folders say "Year 11" and mean Grade 11, set this to 0.
  YEAR_TO_GRADE_OFFSET: -1,

  // A file is kept only if its name or one of its folders sounds like a practical
  // (practical, lab, experiment, investigation, required practical, PAG, CPAC, IA…).
  REQUIRE_PRACTICAL_WORD: true,

  // Only used when GRADES is a list: keep files whose grade can't be worked out.
  INCLUDE_UNKNOWN_GRADE: true,

  // Skip student work: any "Classroom" folder (Google Classroom hand-ins) and folders named like the ones below.
  EXCLUDE_CLASSROOM_FOLDER: true,
  // "…_files" folders are the leftovers of web pages saved from a browser.
  EXCLUDE_RE: /_files\b|\b(homework|student\s*(work|submissions?|reports?|ia)|submissions?|hand\s*ins?|marked|graded|portfolios?|mark\s*schemes?|exam\s*papers?|past\s*papers?)\b/i,

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
var IGCSE_RE = /\bi\s*gcse\b|\bgcse\b|\b06[0-9]{2}\b|\btriple\b|\bcombined\s+science\b|\bdouble\s+(award|science)\b/i;
var MYP_RE = /\bmyp\b|middle\s+years\s+programme/i;
var KS3_RE = /\bks\s*3\b|key\s*stage\s*3|lower\s+secondary|\bcheckpoint\b/i;
var KS_GRADES = { 3: [6, 7, 8], 4: [9, 10], 5: [11, 12] };

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
  if (typeof Drive === 'undefined') {
    throw new Error('The Drive API service is not switched on. In the editor: Services (left sidebar) → + → ' +
      'Drive API → Version v3 → Add. Then run startScan again.');
  }
  var rootId = folderIdFromConfig_();
  var st = loadState_();
  if (st && st.phase !== 'done' && st.rootFolderId !== rootId) {
    Logger.log('The unfinished scan was for another folder — starting again for the new one.');
    st = null;
  }
  if (st && st.phase !== 'done') {
    Logger.log('A scan is already in progress (phase: ' + st.phase + '). Continuing it. Run resetScan() first to start again.');
  } else {
    st = newState_(rootId);
    saveState_(st);
    Logger.log('New scan started for folder: ' + st.rootName);
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
  // Breadth-first walk: list the subfolders of up to 30 known folders per request.
  while (st.qi < st.queue.length && timeLeft()) {
    if (!st.batchEnd) st.batchEnd = Math.min(st.qi + 30, st.queue.length);
    var batch = st.queue.slice(st.qi, st.batchEnd);
    var res = listChildren_(st, batch, "mimeType='" + MIME.FOLDER + "'", 'files(id,name,parents)');
    (res.files || []).forEach(function (f) {
      if (st.folders[f.id] || f.id === st.outputFolderId) return;
      st.folders[f.id] = [f.name, parentInTree_(st, f.parents)];
      st.queue.push(f.id);
    });
    st.pageToken = res.nextPageToken || '';
    if (!st.pageToken) { st.qi = st.batchEnd; st.batchEnd = 0; }
  }
  if (st.qi >= st.queue.length) {
    st.phase = 'files';
    st.stats.folders = st.queue.length;
    st.qi = 0; st.batchEnd = 0; st.pageToken = '';
  }
}

/* ---------------------------------------------------------------- phase 2: files */

function scanFiles_(st, timeLeft) {
  var mimeQ = '(' + WANTED_MIME.map(function (m) { return "mimeType='" + m + "'"; }).join(' or ') + ')';
  while (st.qi < st.queue.length && timeLeft()) {
    if (!st.batchEnd) st.batchEnd = Math.min(st.qi + 30, st.queue.length);
    var batch = st.queue.slice(st.qi, st.batchEnd);
    var res = listChildren_(st, batch, mimeQ, 'files(id,name,mimeType,parents,webViewLink,modifiedTime,createdTime,size,md5Checksum)');
    (res.files || []).forEach(function (f) {
      if (st.seen[f.id]) return; // a file can sit in two folders of the tree
      st.seen[f.id] = 1;
      st.stats.files++;
      var c = classify_(st, f);
      if (c) st.candidates.push(c);
    });
    st.pageToken = res.nextPageToken || '';
    if (!st.pageToken) { st.qi = st.batchEnd; st.batchEnd = 0; }
  }
  if (st.qi >= st.queue.length) {
    markDuplicates_(st.candidates);
    st.phase = CONFIG.EXTRACT_TEXT ? 'extract' : 'write';
    st.next = 0; st.seen = {};
  }
}

/** One page of the items directly inside any of the given folders. */
function listChildren_(st, folderIds, extraQ, fileFields) {
  var parentsQ = '(' + folderIds.map(function (id) { return "'" + id + "' in parents"; }).join(' or ') + ')';
  var args = {
    q: parentsQ + ' and trashed=false and ' + extraQ,
    includeItemsFromAllDrives: true, supportsAllDrives: true,
    pageSize: 1000, fields: 'nextPageToken, ' + fileFields
  };
  if (st.driveId) { args.corpora = 'drive'; args.driveId = st.driveId; }
  if (st.pageToken) args.pageToken = st.pageToken;
  for (var attempt = 0; ; attempt++) {
    try { return Drive.Files.list(args); }
    catch (e) { if (attempt >= 2) throw e; Utilities.sleep(2000 * (attempt + 1)); }
  }
}

function parentInTree_(st, parents) {
  parents = parents || [];
  for (var i = 0; i < parents.length; i++) if (st.folders[parents[i]]) return parents[i];
  return parents[0] || '';
}

function classify_(st, f) {
  var chain = folderChain_(st, parentInTree_(st, f.parents));

  var baseName = f.name.replace(/\.[a-z0-9]{2,5}$/i, '');
  // look at the file name first, then the nearest folder, then further up
  var parts = [baseName].concat(chain.names.slice().reverse());
  var norm = parts.map(norm_);
  var all = norm.join(' / ');

  if (CONFIG.EXCLUDE_RE && (CONFIG.EXCLUDE_RE.test(all) || CONFIG.EXCLUDE_RE.test(parts.join(' / ')))) return null;
  if (CONFIG.EXCLUDE_CLASSROOM_FOLDER && chain.names.some(function (n) { return /^classroom$/i.test(n); })) return null;
  var isPractical = PRACTICAL_RE.test(all);
  if (CONFIG.REQUIRE_PRACTICAL_WORD && !isPractical) return null;

  var g = detectGrades_(parts, norm, IB_RE.test(all));
  var course = detectCourse_(parts, norm, g.grades);
  if (CONFIG.GRADES !== 'all') {
    var want = CONFIG.GRADES;
    var match = g.grades && g.grades.some(function (x) { return want.indexOf(x) >= 0; });
    if (!match && !(!g.grades && CONFIG.INCLUDE_UNKNOWN_GRADE)) return null;
  }

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
    grades: g.grades || [],
    gradeEvidence: g.evidence || null,
    course: course.course || null,
    courseEvidence: course.evidence || null,
    subject: subj.subject || null,
    subjectEvidence: subj.evidence || null,
    topicGuess: topicGuess_(chain.names),
    extract: 'pending'
  };
}

/**
 * Grades from the file name, then the nearest folder, then further up. Returns a list:
 * "Grade 8" → [8], "Grade 9 & 10" → [9, 10], "Key Stage 4 (9 - 10)" → [9, 10], "DP1" → [11].
 */
function detectGrades_(parts, norm, isIB) {
  var off = CONFIG.YEAR_TO_GRADE_OFFSET;
  for (var i = 0; i < parts.length; i++) {
    var raw = String(parts[i]), low = raw.toLowerCase(), s = norm[i], m, r;
    if ((m = s.match(/\b(?:dp|ib|ibdp)\s*(?:year|yr|y)?\s*([12])\b/))) return hit_([10 + Number(m[1])], raw);
    // ranges: "Grade 9 & 10", "Grades 6-8", "Year 12/13", "Key Stage 3 (6 - 8)"
    if ((m = low.match(/\b(grades?|grd|gr|g|years?|yrs?|y)\s*\.?\s*(\d{1,2})\s*(?:-|–|&|and|to|\/|,)\s*(?:(?:grade|year|g|y)\s*)?(\d{1,2})\b/))) {
      var o = /^y/.test(m[1]) ? off : 0;
      if ((r = range_(Number(m[2]) + o, Number(m[3]) + o))) return hit_(r, raw);
    }
    if ((m = low.match(/key\s*stage\s*(\d)\s*\(\s*(\d{1,2})\s*(?:-|–|to|&)\s*(\d{1,2})\s*\)/)) && (r = range_(Number(m[2]), Number(m[3])))) return hit_(r, raw);
    if ((m = s.match(/\b(?:grade|grd|gr|g)\s*\.?\s*(\d{1,2})\b/)) && valid_(Number(m[1]))) return hit_([Number(m[1])], raw);
    if ((m = s.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:grade|gr)\b/)) && valid_(Number(m[1]))) return hit_([Number(m[1])], raw);
    if ((m = s.match(/\b(?:year|yr|y)\s*\.?\s*(\d{1,2})\b/))) {
      var y = Number(m[1]);
      if (isIB && (y === 1 || y === 2)) return hit_([10 + y], raw); // "IB Chemistry / Year 1"
      if (valid_(y + off)) return hit_([y + off], raw);
    }
    if ((m = s.match(/\b(?:key\s*stage|ks)\s*([345])\b/))) return hit_(KS_GRADES[m[1]], raw);
    if (/\bas\s*level\b/.test(s) || (!isIB && /\bAS\b/.test(raw))) return hit_([11], raw);
    if (/\ba 2\s*level\b/.test(s) || (!isIB && /\bA2\b/.test(raw))) return hit_([12], raw);
    if (isIB && /\bfirst\s+year\b/.test(s)) return hit_([11], raw);
    if (isIB && /\bsecond\s+year\b/.test(s)) return hit_([12], raw);
  }
  return {};
}
function valid_(n) { return n >= 1 && n <= 13; }
function range_(a, b) {
  if (!valid_(a) || !valid_(b) || b < a || b - a > 4) return null;
  var r = []; for (var n = a; n <= b; n++) r.push(n); return r;
}
function hit_(grades, raw) { return { grades: grades, evidence: raw }; }

function detectCourse_(parts, norm, grades) {
  var lo = grades && grades.length ? grades[0] : null, hi = grades && grades.length ? grades[grades.length - 1] : null;
  var senior = lo === null || lo >= 11, junior = hi === null || hi <= 10;
  for (var i = 0; i < norm.length; i++) {
    var ib = IB_RE.test(norm[i]), al = AL_RE.test(norm[i]) || (!IB_RE.test(norm.join(' ')) && AL_CASE_RE.test(parts[i]));
    // a course name that can't fit the grade (an "A Level" note in a Grade 9 folder) is ignored
    if (senior && ib && !al) return { course: 'IB', evidence: parts[i] };
    if (senior && al && !ib) return { course: 'A Level', evidence: parts[i] };
    if (senior && ib && al) return { course: 'IB / A Level', evidence: parts[i] };
    if (junior && IGCSE_RE.test(norm[i])) return { course: 'IGCSE', evidence: parts[i] };
    if (junior && MYP_RE.test(norm[i])) return { course: 'MYP', evidence: parts[i] };
    if (junior && KS3_RE.test(norm[i])) return { course: 'KS3', evidence: parts[i] };
  }
  // nothing named: at this school Grades 6–8 are KS3 and Grades 9–10 are IGCSE
  if (hi !== null && hi <= 8) return { course: 'KS3', evidence: 'grade' };
  if (lo !== null && lo >= 9 && hi <= 10) return { course: 'IGCSE', evidence: 'grade' };
  return {};
}

function detectSubject_(norm) {
  for (var i = 0; i < norm.length; i++) {
    for (var j = 0; j < SUBJECTS.length; j++) if (SUBJECTS[j][1].test(norm[i])) return { subject: SUBJECTS[j][0], evidence: norm[i] };
  }
  return {};
}

/** The nearest folder whose name isn't just a grade, course, subject or "practicals" — tidied up. */
function topicGuess_(names) {
  var generic = /^(required|core|dept|depts|department|faculty|teachers?|staff|pracs?|experiments?|investigations?|worksheets?|resources?|docs?|documents?|files?|teaching|teaching\s+notes|curriculum|sciences?|shared|my\s*drive|archive[ds]?|old|new|misc|other|lessons?|assessments?|requisitions?|orders?|planning|sow|sow\s+and\s+planning|internal\s+assessment|ia|ee|ia\s+ee|key\s+stage|triple|combined|\d{4}([-\/]\d{2,4})?|term\s*\d|sem(ester)?\s*\d|unit\s*\d+)$/i;
  for (var i = names.length - 1; i >= 1; i--) {
    var t = String(names[i])
      .replace(/^\s*(?:\d+|[a-z]?\d+[a-z]?)\s*[-–.)]\s*/i, '')          // "4 - …", "L6 - …"
      .replace(/^\s*(?:topic|unit|chapter|module)\s*\d+(\.\d+)*\s*[-–:.]?\s*/i, '')
      .replace(/\([^)]*\)/g, ' ').replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    var stripped = norm_(t).replace(/\b(grades?|years?|gr|yr|g|y)\s*\d{1,2}(\s*(and|&)\s*\d{1,2})?\b|\bkey\s*stage\s*\d\b|\b(ib|dp|ibdp|hl|sl|a\s*level|as|a 2|cie|caie|aqa|ocr|edexcel|igcse|gcse|myp|ks\s*\d|international\s+baccalaureate|group\s*4)\b|\b(biology|chemistry|physics|bio|chem|phys|science|ess|sehs)\b|\b(practicals?|practical's|labs?|technicians?)\b/gi, '').replace(/[\s\-_.,:&'’]+/g, ' ').trim();
    if (stripped.length >= 3 && !generic.test(stripped)) return t.replace(/\s*[-–]\s*$/, '');
  }
  return null;
}

function folderChain_(st, parentId) {
  var names = [], guard = 0, id = parentId;
  while (id && st.folders[id] && guard++ < 60) {
    names.push(st.folders[id][0]);
    id = st.folders[id][1];
  }
  return { names: names.reverse() };
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
          // "Cambridge International AS & A Level" in a header names the course, not the grade
          parsed.head = parsed.head.replace(/\bAS\s*(&|and)\s*A\s*Level\b/gi, 'A Level');
          if (!c.grades || !c.grades.length) { var g = detectGrades_([parsed.head], [norm_(parsed.head)], c.course === 'IB'); if (g.grades) { c.grades = g.grades; c.gradeEvidence = 'document'; } }
          if (!c.course) { var co = detectCourse_([parsed.head], [norm_(parsed.head)], c.grades); if (co.course) { c.course = co.course; c.courseEvidence = 'document'; } }
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
      line = line.replace(/^\s*(?:[*•\-–·o▪●]|\(?[a-z]\)|\d+[.)])\s+/i, '').trim();
      var q = line.match(/^(\d+(?:\.\d+)?)\s*(?:x|×)?\s+(.+)$/i);
      return q ? { name: q[2].trim(), perGroup: Number(q[1]) } : { name: line, perGroup: 1 };
    }).filter(function (k) { return k.name.length > 1 && k.name.length < 160; });
    return {
      // fields of the app's Library table
      id: 'drv-' + c.driveFileId,
      title: bestTitle_(c),
      grade: c.grades && c.grades.length === 1 ? c.grades[0] : null,
      grades: c.grades || [],
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
    return ((a.grades[0] || 99) - (b.grades[0] || 99)) || String(a.course).localeCompare(String(b.course)) ||
      String(a.subject).localeCompare(String(b.subject)) || String(a.topic).localeCompare(String(b.topic)) || a.title.localeCompare(b.title);
  });

  var count = function (key) { var o = {}; practicals.forEach(function (p) { var k = p[key] == null ? 'unknown' : String(p[key]); o[k] = (o[k] || 0) + 1; }); return o; };
  var out = {
    kind: 'practical-library-scan',
    version: 1,
    generatedAt: new Date().toISOString(),
    complete: !partial,
    notes: [
      'grades/course/subject come from folder and file names (see source.*Evidence). grade is set only when exactly one grade applies; grades lists them all (e.g. [9, 10]).',
      'kit is taken from the Equipment/Apparatus section of each file; check quantities before import.',
      'source.duplicateOf marks the same file stored in another folder.'
    ],
    settings: { grades: CONFIG.GRADES, yearToGradeOffset: CONFIG.YEAR_TO_GRADE_OFFSET, requirePracticalWord: CONFIG.REQUIRE_PRACTICAL_WORD, includeUnknownGrade: CONFIG.INCLUDE_UNKNOWN_GRADE, scannedFolder: { id: st.rootFolderId, name: st.rootName } },
    stats: {
      foldersScanned: st.stats.folders, filesScanned: st.stats.files, practicalsFound: practicals.length,
      textRead: st.stats.textRead, conversions: st.stats.conversions, errors: st.stats.errors,
      duplicates: practicals.filter(function (p) { return p.source.duplicateOf; }).length,
      byGrade: (function () { var o = {}; practicals.forEach(function (p) { var k = p.grades.length ? p.grades.join('–') : 'unknown'; o[k] = (o[k] || 0) + 1; }); return o; })(), byCourse: count('course'), bySubject: count('subject')
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
  st.folders = {}; st.queue = []; // free up the state file
  if (CONFIG.NOTIFY_BY_EMAIL) {
    try {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Practical library scan finished',
        practicals.length + ' practicals found in ' + st.stats.files + ' files.\n\n' +
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

function newState_(rootId) {
  var root;
  try { root = Drive.Files.get(rootId, { supportsAllDrives: true, fields: 'id,name,mimeType,driveId' }); }
  catch (e) { throw new Error('Can\'t open folder ' + rootId + ' — check the ID and that this account can see it. (' + e.message + ')'); }
  if (root.mimeType !== MIME.FOLDER) throw new Error('"' + root.name + '" is not a folder. Put a folder ID in CONFIG.FOLDER_ID.');
  var out = outputFolder_({});
  var folders = {};
  folders[root.id] = [root.name, ''];
  return {
    phase: 'folders', startedAt: new Date().toISOString(),
    rootFolderId: root.id, rootName: root.name, driveId: root.driveId || '',
    outputFolderId: out.getId(), tmpFolderId: '',
    folders: folders, queue: [root.id], qi: 0, batchEnd: 0, pageToken: '', seen: {},
    candidates: [], next: 0,
    stats: { folders: 0, files: 0, textRead: 0, conversions: 0, errors: 0 }
  };
}

function folderIdFromConfig_() {
  var v = String(CONFIG.FOLDER_ID || '').trim();
  var m = v.match(/folders\/([A-Za-z0-9_-]{10,})/) || v.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) v = m[1];
  if (!/^[A-Za-z0-9_-]{10,}$/.test(v)) throw new Error('Put the ID of the folder to scan in CONFIG.FOLDER_ID (top of the script).');
  return v;
}

function statusLine_(st) {
  var s = st.stats;
  var where = { folders: 'finding subfolders of "' + st.rootName + '" (' + Object.keys(st.folders || {}).length + ' so far)', files: 'checking files in folder ' + st.qi + ' of ' + st.queue.length + ' (' + s.files + ' checked, ' + st.candidates.length + ' practicals so far)', extract: 'reading files (' + st.next + ' of ' + st.candidates.length + ')', write: 'writing the JSON', done: 'done' }[st.phase];
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
