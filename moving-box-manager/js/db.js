/**
 * db.js — מטמון מקומי מבוסס IndexedDB.
 *
 * המטמון הוא מקור האמת של הממשק: כל קריאה וכתיבה עוברות דרכו, וגם כשאין
 * רשת האפליקציה עובדת במלואה. מנוע הסנכרון (sync.js) הוא זה שמיישב בין
 * המטמון לגיליון בענן.
 */

import { DB } from './config.js';

let dbPromise = null;
let storageMode = null; // 'idb' | 'local'

/**
 * אחסון חלופי מעל localStorage, למקרה ש-IndexedDB חסום — למשל בגלישה
 * פרטית או בדף שמוגש בתוך מסגרת מבודדת. הממשק זהה, כך שכל שאר האפליקציה
 * אינה יודעת באיזה אחסון היא משתמשת.
 */
const FALLBACK_KEY = 'mbm.storage.v1';

function readFallback() {
  try {
    return JSON.parse(localStorage.getItem(FALLBACK_KEY) || '') || { boxes: {}, meta: {} };
  } catch {
    return { boxes: {}, meta: {} };
  }
}

function writeFallback(data) {
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn('שמירה לאחסון המקומי נכשלה', error);
  }
}

/** קובע פעם אחת באיזה אחסון משתמשים, ומעדיף תמיד את IndexedDB. */
async function mode() {
  if (storageMode) return storageMode;
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB אינו קיים');
    await openDatabase();
    storageMode = 'idb';
  } catch (error) {
    console.warn('IndexedDB אינו זמין — עוברים לאחסון מקומי', error);
    storageMode = 'local';
  }
  return storageMode;
}

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB.NAME, DB.VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DB.STORE_BOXES)) {
        const store = database.createObjectStore(DB.STORE_BOXES, { keyPath: 'id' });
        store.createIndex('room', 'room', { unique: false });
        store.createIndex('number', 'number', { unique: false });
        store.createIndex('dirty', 'dirty', { unique: false });
      }
      if (!database.objectStoreNames.contains(DB.STORE_META)) {
        database.createObjectStore(DB.STORE_META, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function runTransaction(storeName, mode, operation) {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        let result;
        try {
          result = operation(store);
        } catch (error) {
          reject(error);
          return;
        }
        transaction.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      })
  );
}

/** כל הארגזים במטמון, כולל כאלה שסומנו כמחוקים. */
export async function getAllBoxes() {
  if ((await mode()) === 'local') return Object.values(readFallback().boxes);
  const boxes = await runTransaction(DB.STORE_BOXES, 'readonly', (store) => store.getAll());
  return boxes || [];
}

export async function putBox(box) {
  if ((await mode()) === 'local') {
    const data = readFallback();
    data.boxes[box.id] = box;
    writeFallback(data);
    return box.id;
  }
  return runTransaction(DB.STORE_BOXES, 'readwrite', (store) => store.put(box));
}

/** כתיבת אצווה — משמשת בעיקר לקליטת תוצאות סנכרון. */
export async function putBoxes(boxes) {
  if ((await mode()) === 'local') {
    const data = readFallback();
    for (const box of boxes) data.boxes[box.id] = box;
    writeFallback(data);
    return boxes.length;
  }
  return runTransaction(DB.STORE_BOXES, 'readwrite', (store) => {
    for (const box of boxes) store.put(box);
    return boxes.length;
  });
}

export async function getBox(id) {
  if ((await mode()) === 'local') return readFallback().boxes[id] || undefined;
  return runTransaction(DB.STORE_BOXES, 'readonly', (store) => store.get(id));
}

export async function deleteBoxPermanently(id) {
  if ((await mode()) === 'local') {
    const data = readFallback();
    delete data.boxes[id];
    writeFallback(data);
    return;
  }
  return runTransaction(DB.STORE_BOXES, 'readwrite', (store) => store.delete(id));
}

export async function clearBoxes() {
  if ((await mode()) === 'local') {
    const data = readFallback();
    data.boxes = {};
    writeFallback(data);
    return;
  }
  return runTransaction(DB.STORE_BOXES, 'readwrite', (store) => store.clear());
}

/** ערך מטא־נתונים (סמן סנכרון, מאגר מספרים וכדומה). */
export async function getMeta(key, fallbackValue = null) {
  if ((await mode()) === 'local') {
    const stored = readFallback().meta[key];
    return stored === undefined ? fallbackValue : stored;
  }
  const record = await runTransaction(DB.STORE_META, 'readonly', (store) => store.get(key));
  return record ? record.value : fallbackValue;
}

export async function setMeta(key, value) {
  if ((await mode()) === 'local') {
    const data = readFallback();
    data.meta[key] = value;
    writeFallback(data);
    return;
  }
  return runTransaction(DB.STORE_META, 'readwrite', (store) => store.put({ key, value }));
}

/** בדיקה שיש אחסון כלשהו לעבוד מולו. */
export function isSupported() {
  return typeof indexedDB !== 'undefined' || typeof localStorage !== 'undefined';
}
