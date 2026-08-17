/**
 * Code.gs — שרת הסנכרון של אפליקציית ניהול הארגזים.
 *
 * הסקריפט יושב על גיליון Google Sheets בחשבון ה-Drive של המנהל, ומספק
 * ממשק JSON לאפליקציה: משיכת שינויים, דחיפת שינויים, שריון מספרי ארגז
 * וגיבוי ל-Drive.
 *
 * התקנה מלאה: ראו README.md בתיקיית הפרויקט. בקצרה —
 *   1. פותחים גיליון חדש ב-Drive ובוחרים Extensions → Apps Script.
 *   2. מדביקים את הקובץ הזה, שומרים, ומריצים פעם אחת את setup().
 *   3. Deploy → New deployment → Web app → Execute as: Me,
 *      Who has access: Anyone. מעתיקים את כתובת ה-‎/exec לאפליקציה.
 *
 * הערה על אבטחה: פריסה מסוג "Anyone" אינה דורשת התחברות, ולכן הכתובת
 * עצמה היא סוד. setup() מייצר מפתח גישה (TOKEN) שנדרש בכל בקשה — אל
 * תשתפו את הכתובת ואת המפתח מחוץ למשפחה.
 */

// ---------------------------------------------------------------------------
// קבועים
// ---------------------------------------------------------------------------

var SHEET_NAME = 'Boxes';
var BACKUP_FOLDER_NAME = 'גיבויים — ניהול ארגזים';
var BACKUPS_TO_KEEP = 14;
var LOCK_TIMEOUT_MS = 20000;

/** סדר העמודות בגיליון. אין לשנות סדר אחרי שהתחלתם לעבוד. */
var HEADERS = [
  'id',
  'number',
  'boxNumber',
  'room',
  'items',
  'fragile',
  'priority',
  'notes',
  'createdAt',
  'updatedAt',
  'deleted',
  'updatedBy',
  'seq',
];

var PROP_TOKEN = 'TOKEN';
var PROP_SEQ = 'SEQ';
var PROP_NEXT_NUMBER = 'NEXT_NUMBER';

// ---------------------------------------------------------------------------
// נקודות הכניסה של אפליקציית הווב
// ---------------------------------------------------------------------------

function doGet(e) {
  return handleRequest((e && e.parameter) || {});
}

function doPost(e) {
  var payload = {};
  try {
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }
  } catch (error) {
    return jsonResponse({ ok: false, error: 'גוף הבקשה אינו JSON תקין', code: 'BAD_JSON' });
  }
  return handleRequest(payload);
}

function handleRequest(request) {
  try {
    var expectedToken = PropertiesService.getScriptProperties().getProperty(PROP_TOKEN);
    if (expectedToken && String(request.token || '') !== expectedToken) {
      return jsonResponse({ ok: false, error: 'מפתח גישה שגוי', code: 'BAD_TOKEN' });
    }

    switch (request.action) {
      case 'ping':
        return jsonResponse(handlePing());
      case 'pull':
        return jsonResponse(handlePull(Number(request.since) || 0));
      case 'push':
        return jsonResponse(handlePush(request.boxes || [], request.device || ''));
      case 'reserve':
        return jsonResponse(handleReserve(Number(request.count) || 20, request.device || ''));
      case 'backup':
        return jsonResponse(handleBackup());
      default:
        return jsonResponse({ ok: false, error: 'פעולה לא מוכרת: ' + request.action, code: 'BAD_ACTION' });
    }
  } catch (error) {
    return jsonResponse({ ok: false, error: String((error && error.message) || error), code: 'EXCEPTION' });
  }
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// הפעולות
// ---------------------------------------------------------------------------

function handlePing() {
  var sheet = ensureSheet();
  return {
    ok: true,
    rows: Math.max(0, sheet.getLastRow() - 1),
    cursor: currentSeq(),
    nextNumber: Number(PropertiesService.getScriptProperties().getProperty(PROP_NEXT_NUMBER) || 1),
    serverTime: new Date().toISOString(),
    version: 1,
  };
}

/**
 * כל הרשומות שהשתנו מאז הסמן שהלקוח מחזיק.
 *
 * הסמן המוחזר הוא ה-seq הגבוה ביותר שנקרא בפועל מהגיליון, ולא מונה ה-seq
 * הגלובלי: אם מכשיר אחר כתב רשומה בזמן שהקריאה הזו התבצעה, המונה כבר מתקדם
 * ממנה, והחזרתו הייתה גורמת ללקוח לדלג על אותה רשומה לתמיד.
 */
function handlePull(since) {
  var rows = readAllRows();
  var boxes = [];
  var cursor = since;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].seq > cursor) cursor = rows[i].seq;
    if (rows[i].seq > since) boxes.push(toClientBox(rows[i]));
  }
  return { ok: true, boxes: boxes, cursor: cursor, serverTime: new Date().toISOString() };
}

/**
 * קליטת שינויים ממכשיר.
 *
 * יישוב התנגשויות: הרשומה בעלת updatedAt המאוחר יותר מנצחת. ההכרעה
 * מתבצעת כאן, בשרת, כדי שכל המכשירים יתכנסו לאותה תוצאה. התשובה מחזירה
 * תמיד את הגרסה הקובעת — גם כשהיא זו שכבר הייתה בגיליון.
 */
function handlePush(incomingBoxes, device) {
  if (!incomingBoxes.length) return { ok: true, boxes: [], cursor: currentSeq() };

  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    var sheet = ensureSheet();
    var rows = readAllRows();
    var indexById = {};
    for (var i = 0; i < rows.length; i++) indexById[rows[i].id] = i;

    var seq = currentSeq();
    var resolved = [];
    var appended = [];
    var updates = []; // {rowNumber, values}

    for (var j = 0; j < incomingBoxes.length; j++) {
      var incoming = normalizeIncoming(incomingBoxes[j], device);
      if (!incoming.id) continue;

      var existingIndex = indexById[incoming.id];

      if (existingIndex === undefined) {
        // רשומה חדשה — אם היא נוצרה ללא רשת ואין לה מספר, משבצים לה מספר עכשיו
        if (!incoming.number) {
          incoming.number = allocateNumbers(1).from;
          incoming.boxNumber = formatBoxNumber(incoming.number);
        }
        incoming.seq = ++seq;
        appended.push(toSheetRow(incoming));
        resolved.push(toClientBox(incoming));
        continue;
      }

      var existing = rows[existingIndex];
      if (String(incoming.updatedAt) > String(existing.updatedAt)) {
        // המכשיר מחזיק בגרסה החדשה יותר — היא נכתבת לגיליון
        if (!incoming.number && existing.number) {
          incoming.number = existing.number;
          incoming.boxNumber = existing.boxNumber;
        }
        if (!incoming.number) {
          incoming.number = allocateNumbers(1).from;
          incoming.boxNumber = formatBoxNumber(incoming.number);
        }
        incoming.createdAt = existing.createdAt || incoming.createdAt;
        incoming.seq = ++seq;
        updates.push({ rowNumber: existing.rowNumber, values: toSheetRow(incoming) });
        rows[existingIndex] = incoming;
        resolved.push(toClientBox(incoming));
      } else {
        // הגיליון מחזיק בגרסה החדשה יותר — היא זו שתחזור למכשיר
        resolved.push(toClientBox(existing));
      }
    }

    for (var k = 0; k < updates.length; k++) {
      sheet.getRange(updates[k].rowNumber, 1, 1, HEADERS.length).setValues([updates[k].values]);
    }
    if (appended.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appended.length, HEADERS.length).setValues(appended);
    }

    setSeq(seq);
    return { ok: true, boxes: resolved, cursor: seq };
  } finally {
    lock.releaseLock();
  }
}

/** שריון בלוק מספרים רציף למכשיר, כדי לאפשר יצירת ארגזים גם ללא רשת. */
function handleReserve(count, device) {
  var safeCount = Math.min(Math.max(count, 1), 500);
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_TIMEOUT_MS);
  try {
    var range = allocateNumbers(safeCount);
    return { ok: true, from: range.from, to: range.to, device: device };
  } finally {
    lock.releaseLock();
  }
}

/** גיבוי הגיליון כקובץ נפרד בתיקייה ייעודית ב-Drive. */
function handleBackup() {
  var file = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  var folder = getBackupFolder();
  var name = 'ארגזים — גיבוי ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  var copy = file.makeCopy(name, folder);
  pruneBackups(folder);
  return { ok: true, name: name, id: copy.getId(), url: copy.getUrl() };
}

// ---------------------------------------------------------------------------
// גישה לגיליון
// ---------------------------------------------------------------------------

function ensureSheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // עמודות טקסט — כדי ש-Sheets לא ימיר תאריכי ISO לאובייקטי תאריך
    sheet.getRange(1, 1, sheet.getMaxRows(), HEADERS.length).setNumberFormat('@');
  }
  return sheet;
}

function readAllRows() {
  var sheet = ensureSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = fromSheetRow(values[i]);
    if (!row.id) continue;
    row.rowNumber = i + 2;
    rows.push(row);
  }
  return rows;
}

function fromSheetRow(values) {
  var map = {};
  for (var i = 0; i < HEADERS.length; i++) map[HEADERS[i]] = values[i];
  return {
    id: String(map.id || ''),
    number: map.number === '' || map.number === null ? null : Number(map.number),
    boxNumber: String(map.boxNumber || ''),
    room: String(map.room || ''),
    items: splitItems(map.items),
    fragile: toBoolean(map.fragile),
    priority: String(map.priority || 'normal'),
    notes: String(map.notes || ''),
    createdAt: toIsoString(map.createdAt),
    updatedAt: toIsoString(map.updatedAt),
    deleted: toBoolean(map.deleted),
    updatedBy: String(map.updatedBy || ''),
    seq: Number(map.seq || 0),
  };
}

function toSheetRow(box) {
  return [
    box.id,
    box.number === null || box.number === undefined ? '' : box.number,
    box.boxNumber || '',
    box.room || '',
    (box.items || []).join(', '),
    box.fragile ? 'TRUE' : 'FALSE',
    box.priority || 'normal',
    box.notes || '',
    box.createdAt || '',
    box.updatedAt || '',
    box.deleted ? 'TRUE' : 'FALSE',
    box.updatedBy || '',
    box.seq || 0,
  ];
}

/** הפורמט שהאפליקציה מצפה לו (בלי שדות פנימיים של הגיליון). */
function toClientBox(row) {
  return {
    id: row.id,
    number: row.number,
    boxNumber: row.boxNumber,
    room: row.room,
    items: row.items,
    fragile: row.fragile,
    priority: row.priority,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deleted: row.deleted,
    updatedBy: row.updatedBy,
    seq: row.seq,
  };
}

function normalizeIncoming(box, device) {
  var number = box.number === null || box.number === undefined || box.number === '' ? null : Number(box.number);
  return {
    id: String(box.id || ''),
    number: number,
    boxNumber: box.boxNumber || (number ? formatBoxNumber(number) : ''),
    room: String(box.room || ''),
    items: Array.isArray(box.items) ? box.items : splitItems(box.items),
    fragile: toBoolean(box.fragile),
    priority: box.priority === 'high' ? 'high' : 'normal',
    notes: String(box.notes || ''),
    createdAt: toIsoString(box.createdAt) || new Date().toISOString(),
    updatedAt: toIsoString(box.updatedAt) || new Date().toISOString(),
    deleted: toBoolean(box.deleted),
    updatedBy: String(box.updatedBy || device || ''),
    seq: 0,
  };
}

// ---------------------------------------------------------------------------
// מונים
// ---------------------------------------------------------------------------

function currentSeq() {
  return Number(PropertiesService.getScriptProperties().getProperty(PROP_SEQ) || 0);
}

function setSeq(value) {
  PropertiesService.getScriptProperties().setProperty(PROP_SEQ, String(value));
}

/** הקצאת טווח מספרי ארגז רציף. יש לקרוא בתוך נעילה. */
function allocateNumbers(count) {
  var properties = PropertiesService.getScriptProperties();
  var from = Number(properties.getProperty(PROP_NEXT_NUMBER) || 1);
  var to = from + count - 1;
  properties.setProperty(PROP_NEXT_NUMBER, String(to + 1));
  return { from: from, to: to };
}

function formatBoxNumber(number) {
  var text = String(number);
  while (text.length < 3) text = '0' + text;
  return 'BOX-' + text;
}

// ---------------------------------------------------------------------------
// עזרים
// ---------------------------------------------------------------------------

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  var text = String(value || '').trim().toLowerCase();
  return text === 'true' || text === 'כן' || text === '1';
}

function toIsoString(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
  return String(value);
}

function splitItems(value) {
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(/[,;\n]+/)
    .map(function (item) {
      return item.trim();
    })
    .filter(function (item) {
      return item.length > 0;
    });
}

function getBackupFolder() {
  var folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

/** שמירת מספר גיבויים קבוע — הישנים ביותר עוברים לאשפה. */
function pruneBackups(folder) {
  var files = [];
  var iterator = folder.getFiles();
  while (iterator.hasNext()) {
    var file = iterator.next();
    files.push({ file: file, date: file.getDateCreated().getTime() });
  }
  files.sort(function (a, b) {
    return b.date - a.date;
  });
  for (var i = BACKUPS_TO_KEEP; i < files.length; i++) files[i].file.setTrashed(true);
}

// ---------------------------------------------------------------------------
// התקנה ותחזוקה — להרצה ידנית מתוך העורך
// ---------------------------------------------------------------------------

/**
 * הרצה חד-פעמית: מכינה את הגיליון, מייצרת מפתח גישה ומתקינה גיבוי יומי.
 * את המפתח שמודפס ביומן יש להזין באפליקציה במסך ההגדרות.
 */
function setup() {
  ensureSheet();
  var properties = PropertiesService.getScriptProperties();

  if (!properties.getProperty(PROP_TOKEN)) {
    properties.setProperty(PROP_TOKEN, Utilities.getUuid().replace(/-/g, '').slice(0, 16));
  }
  if (!properties.getProperty(PROP_SEQ)) properties.setProperty(PROP_SEQ, '0');
  if (!properties.getProperty(PROP_NEXT_NUMBER)) properties.setProperty(PROP_NEXT_NUMBER, '1');

  installDailyBackup();

  var token = properties.getProperty(PROP_TOKEN);
  Logger.log('מפתח הגישה שלכם (להעתקה לאפליקציה): ' + token);
  return token;
}

/** התקנת טריגר גיבוי יומי, בלי ליצור כפילויות. */
function installDailyBackup() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'dailyBackup') return;
  }
  ScriptApp.newTrigger('dailyBackup').timeBased().atHour(3).everyDays(1).create();
}

function dailyBackup() {
  handleBackup();
}

/** הצגת המפתח הקיים ביומן (Executions → Logs). */
function showToken() {
  Logger.log(PropertiesService.getScriptProperties().getProperty(PROP_TOKEN));
}

/**
 * יצירת מפתח גישה חדש. שימושי אם המפתח הישן נחשף.
 * שימו לב: אחרי ההרצה יש לעדכן את המפתח בכל המכשירים.
 */
function resetToken() {
  var token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  PropertiesService.getScriptProperties().setProperty(PROP_TOKEN, token);
  Logger.log('מפתח הגישה החדש: ' + token);
  return token;
}

/**
 * איפוס מלא — מוחק את כל הארגזים ואת המונים. לשימוש זהיר בלבד,
 * למשל אחרי סיום המעבר וניקוי לקראת שימוש חוזר.
 */
function resetAllData() {
  var sheet = ensureSheet();
  if (sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
  var properties = PropertiesService.getScriptProperties();
  properties.setProperty(PROP_SEQ, '0');
  properties.setProperty(PROP_NEXT_NUMBER, '1');
}
