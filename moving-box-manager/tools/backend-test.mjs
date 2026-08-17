/**
 * בדיקות לקוד השרת (backend/Code.gs) — הרצה: node tools/backend-test.mjs
 *
 * הקובץ נטען לתוך סביבת Node עם תחליפים לשירותי Google (גיליון, מאפיינים,
 * נעילה), כך שאפשר לאמת את חוזה הסנכרון — מספור, סמן, יישוב התנגשויות
 * ומחיקה רכה — בלי לפרוס את הסקריפט.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// תחליפים לשירותי Google
// ---------------------------------------------------------------------------

function createFakeSheet() {
  let cells = []; // מערך דו-ממדי, שורה 1 היא הכותרות

  const ensureSize = (rows, cols) => {
    while (cells.length < rows) cells.push(new Array(cols).fill(''));
    for (const row of cells) while (row.length < cols) row.push('');
  };

  return {
    _dump: () => cells,
    getLastRow: () => cells.length,
    getMaxRows: () => Math.max(cells.length, 1000),
    setFrozenRows: () => {},
    getRange(row, col, numRows = 1, numCols = 1) {
      return {
        getValues() {
          ensureSize(row + numRows - 1, col + numCols - 1);
          return cells
            .slice(row - 1, row - 1 + numRows)
            .map((line) => line.slice(col - 1, col - 1 + numCols));
        },
        setValues(values) {
          ensureSize(row + values.length - 1, col + values[0].length - 1);
          values.forEach((line, index) => {
            line.forEach((value, offset) => {
              cells[row - 1 + index][col - 1 + offset] = value;
            });
          });
          return this;
        },
        setFontWeight() { return this; },
        setNumberFormat() { return this; },
      };
    },
    deleteRows(start, count) {
      cells.splice(start - 1, count);
    },
  };
}

function createContext() {
  const sheets = new Map();
  const properties = new Map();

  const spreadsheet = {
    getId: () => 'fake-spreadsheet-id',
    getSheetByName: (name) => sheets.get(name) || null,
    insertSheet: (name) => {
      const sheet = createFakeSheet();
      sheets.set(name, sheet);
      return sheet;
    },
  };

  return {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (properties.has(key) ? properties.get(key) : null),
        setProperty: (key, value) => properties.set(key, value),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ _text: text, setMimeType: () => ({ _text: text }) }),
    },
    Utilities: {
      getUuid: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      formatDate: () => '2026-01-01 03:00',
    },
    DriveApp: {
      getFileById: () => ({ makeCopy: () => ({ getId: () => 'copy', getUrl: () => 'url' }) }),
      getFoldersByName: () => ({ hasNext: () => false }),
      createFolder: () => ({ getFiles: () => ({ hasNext: () => false }) }),
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ create() {} }) }) }) }),
    },
    Session: { getScriptTimeZone: () => 'Asia/Jerusalem' },
    Logger: { log() {} },
    console,
  };
}

function loadBackend() {
  const source = readFileSync(join(here, '..', 'backend', 'Code.gs'), 'utf8');
  const context = vm.createContext(createContext());
  vm.runInContext(source, context);
  return context;
}

/** קריאה לשרת דרך אותה נקודת כניסה שהאפליקציה משתמשת בה. */
function call(backend, payload, token = backend.__token) {
  const output = backend.doPost({ postData: { contents: JSON.stringify({ token, ...payload }) } });
  return JSON.parse(output._text);
}

function makeBox(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: 'id-' + Math.random().toString(36).slice(2, 10),
    number: null,
    boxNumber: '',
    room: 'מטבח',
    items: ['צלחות', 'כוסות'],
    fragile: false,
    priority: 'normal',
    notes: '',
    createdAt: now,
    updatedAt: now,
    deleted: false,
    updatedBy: 'בדיקה',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// הבדיקות
// ---------------------------------------------------------------------------

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name} ${detail}`);
  }
};

const backend = loadBackend();
backend.__token = backend.setup();

console.log('חוזה השרת:');

// --- מספור ---
const first = call(backend, { action: 'push', boxes: [makeBox()] });
check('ארגז חדש מקבל מספר רץ', first.boxes[0].boxNumber === 'BOX-001', JSON.stringify(first.boxes[0]?.boxNumber));

const second = call(backend, { action: 'push', boxes: [makeBox(), makeBox()] });
check(
  'המספור ממשיך ברצף',
  second.boxes.map((box) => box.boxNumber).join(',') === 'BOX-002,BOX-003',
  second.boxes.map((box) => box.boxNumber).join(',')
);

// --- שריון מספרים ---
const reservedA = call(backend, { action: 'reserve', count: 40 });
const reservedB = call(backend, { action: 'reserve', count: 40 });
check('שריון מחזיר טווח באורך המבוקש', reservedA.to - reservedA.from + 1 === 40);
check('טווחים לשני מכשירים אינם חופפים', reservedB.from > reservedA.to);
check('השריון מתחיל אחרי המספרים שכבר בשימוש', reservedA.from === 4, String(reservedA.from));

const reservedBox = call(backend, {
  action: 'push',
  boxes: [makeBox({ number: reservedA.from, boxNumber: 'BOX-004' })],
});
check('ארגז שנוצר אופליין שומר על המספר ששוריין', reservedBox.boxes[0].boxNumber === 'BOX-004');

// --- סמן ומשיכה ---
const all = call(backend, { action: 'pull', since: 0 });
check('משיכה מאפס מחזירה את כל הארגזים', all.boxes.length === 4, String(all.boxes.length));

const nothingNew = call(backend, { action: 'pull', since: all.cursor });
check('משיכה עם סמן עדכני מחזירה רשימה ריקה', nothingNew.boxes.length === 0);

const cursorBefore = all.cursor;
call(backend, { action: 'push', boxes: [makeBox({ room: 'סלון', items: ['ספה'] })] });
const incremental = call(backend, { action: 'pull', since: cursorBefore });
check('משיכה מצטברת מחזירה רק את החדש', incremental.boxes.length === 1 && incremental.boxes[0].room === 'סלון');
check('הסמן מתקדם', incremental.cursor > cursorBefore);

// --- יישוב התנגשויות ---
const target = all.boxes[0];
const older = call(backend, {
  action: 'push',
  boxes: [{ ...target, items: ['גרסה ישנה'], updatedAt: new Date(Date.parse(target.updatedAt) - 60000).toISOString() }],
});
check(
  'עריכה ישנה יותר נדחית והשרת מחזיר את הגרסה הקובעת',
  !older.boxes[0].items.includes('גרסה ישנה'),
  JSON.stringify(older.boxes[0].items)
);

const newer = call(backend, {
  action: 'push',
  boxes: [{ ...target, items: ['גרסה חדשה'], updatedAt: new Date(Date.now() + 60000).toISOString() }],
});
check('עריכה חדשה יותר מתקבלת', newer.boxes[0].items.includes('גרסה חדשה'));

// --- מחיקה רכה ---
const deleted = call(backend, {
  action: 'push',
  boxes: [{ ...newer.boxes[0], deleted: true, updatedAt: new Date(Date.now() + 120000).toISOString() }],
});
check('מחיקה נשמרת כדגל ולא כמחיקת שורה', deleted.boxes[0].deleted === true);
const afterDelete = call(backend, { action: 'pull', since: 0 });
check(
  'הארגז המחוק עדיין מסונכרן לשאר המכשירים',
  afterDelete.boxes.some((box) => box.id === target.id && box.deleted === true)
);

// --- שמירת שדות ---
const rich = call(backend, {
  action: 'push',
  boxes: [makeBox({ room: 'ארונות בגדים חדר שינה', items: ['מעילים', 'סוודרים'], fragile: true, priority: 'high', notes: 'לפתוח ראשון' })],
});
const saved = rich.boxes[0];
check(
  'כל השדות נשמרים ומוחזרים כראוי',
  saved.fragile === true && saved.priority === 'high' && saved.notes === 'לפתוח ראשון' && saved.items.length === 2,
  JSON.stringify(saved)
);
check('תאריך היצירה נשמר', Boolean(saved.createdAt));

// --- אבטחה ---
const badToken = call(backend, { action: 'ping' }, 'מפתח-שגוי');
check('בקשה עם מפתח שגוי נדחית', badToken.ok === false && badToken.code === 'BAD_TOKEN');
const goodToken = call(backend, { action: 'ping' });
check('בקשה עם המפתח הנכון מתקבלת', goodToken.ok === true && goodToken.rows > 0);

// --- קלט פגום ---
const badAction = call(backend, { action: 'לא-קיים' });
check('פעולה לא מוכרת מוחזרת כשגיאה מסודרת', badAction.ok === false && badAction.code === 'BAD_ACTION');
const badJson = JSON.parse(backend.doPost({ postData: { contents: '{לא json' } })._text);
check('גוף בקשה פגום אינו מפיל את השרת', badJson.ok === false && badJson.code === 'BAD_JSON');

console.log(failures === 0 ? '\nכל הבדיקות עברו ✓' : `\n${failures} בדיקות נכשלו ✗`);
process.exit(failures === 0 ? 0 : 1);
