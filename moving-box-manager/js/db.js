/**
 * db.js — מטמון מקומי מבוסס IndexedDB.
 *
 * המטמון הוא מקור האמת של הממשק: כל קריאה וכתיבה עוברות דרכו, וגם כשאין
 * רשת האפליקציה עובדת במלואה. מנוע הסנכרון (sync.js) הוא זה שמיישב בין
 * המטמון לגיליון בענן.
 */

import { DB } from './config.js';

let dbPromise = null;

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
  const boxes = await runTransaction(DB.STORE_BOXES, 'readonly', (store) => store.getAll());
  return boxes || [];
}

export function putBox(box) {
  return runTransaction(DB.STORE_BOXES, 'readwrite', (store) => store.put(box));
}

/** כתיבת אצווה — משמשת בעיקר לקליטת תוצאות סנכרון. */
export function putBoxes(boxes) {
  return runTransaction(DB.STORE_BOXES, 'readwrite', (store) => {
    for (const box of boxes) store.put(box);
    return boxes.length;
  });
}

export function getBox(id) {
  return runTransaction(DB.STORE_BOXES, 'readonly', (store) => store.get(id));
}

export function deleteBoxPermanently(id) {
  return runTransaction(DB.STORE_BOXES, 'readwrite', (store) => store.delete(id));
}

export function clearBoxes() {
  return runTransaction(DB.STORE_BOXES, 'readwrite', (store) => store.clear());
}

/** ערך מטא־נתונים (סמן סנכרון, מאגר מספרים וכדומה). */
export async function getMeta(key, fallback = null) {
  const record = await runTransaction(DB.STORE_META, 'readonly', (store) => store.get(key));
  return record ? record.value : fallback;
}

export function setMeta(key, value) {
  return runTransaction(DB.STORE_META, 'readwrite', (store) => store.put({ key, value }));
}

/** בדיקה שהדפדפן תומך באחסון המקומי הנדרש. */
export function isSupported() {
  return typeof indexedDB !== 'undefined';
}
