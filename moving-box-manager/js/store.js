/**
 * store.js — מצב האפליקציה במקום אחד.
 *
 * כל שינוי בנתונים עובר דרך כאן: הוא נכתב למטמון המקומי, מסומן כ"ממתין
 * לסנכרון", ומודיע למאזינים כדי שהממשק יתרענן. מנוע הסנכרון נרשם דרך
 * onDirty ובכך נמנעת תלות מעגלית בין המודולים.
 */

import * as db from './db.js';

const listeners = new Set();
let dirtyHandler = null;

export const state = {
  /** מפה מזהה→ארגז. כוללת גם ארגזים מחוקים (deleted) לצורכי סנכרון. */
  boxes: new Map(),
  loaded: false,
  sync: {
    /** 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'unconfigured' */
    status: 'idle',
    lastSyncAt: null,
    pendingCount: 0,
    error: '',
  },
};

/** הרשמה לשינויים. מחזירה פונקציית ביטול הרשמה. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify() {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (error) {
      console.error('מאזין נכשל', error);
    }
  }
}

/** רישום מנוע הסנכרון — נקרא בכל פעם שנוצרו שינויים מקומיים לדחיפה. */
export function onDirty(handler) {
  dirtyHandler = handler;
}

/** טעינת המטמון המקומי לזיכרון. */
export async function init() {
  const boxes = await db.getAllBoxes();
  state.boxes = new Map(boxes.map((box) => [box.id, box]));
  state.loaded = true;
  recountPending();
  notify();
}

function recountPending() {
  let pending = 0;
  for (const box of state.boxes.values()) if (box.dirty) pending++;
  state.sync.pendingCount = pending;
}

/** כל הארגזים הפעילים (ללא מחוקים), ממוינים לפי מספר יורד. */
export function activeBoxes() {
  return [...state.boxes.values()]
    .filter((box) => !box.deleted)
    .sort((a, b) => (b.number ?? Infinity) - (a.number ?? Infinity));
}

export function getBox(id) {
  return state.boxes.get(id) || null;
}

/** איתור ארגז לפי מספר מוצג (BOX-001) או לפי מספר סידורי. */
export function findByNumber(value) {
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/\D+/g, ''));
  for (const box of state.boxes.values()) {
    if (box.deleted) continue;
    if (box.boxNumber === value || (Number.isFinite(numeric) && box.number === numeric)) return box;
  }
  return null;
}

/**
 * שמירת ארגז שנוצר או עודכן במכשיר הזה.
 * הרשומה מסומנת dirty ותידחף לשרת בהזדמנות הקרובה.
 */
export async function saveLocal(box) {
  const record = { ...box, dirty: true };
  state.boxes.set(record.id, record);
  await db.putBox(record);
  recountPending();
  notify();
  dirtyHandler?.();
  return record;
}

/**
 * קליטת רשומות מהשרת. רשומה שממתינה לדחיפה מקומית לא תידרס, כדי לא לאבד
 * הקלדה שנעשתה בזמן שהבקשה הייתה בדרך — היא תיושב בדחיפה הבאה.
 */
export async function applyRemote(rows) {
  const toWrite = [];
  for (const row of rows) {
    const existing = state.boxes.get(row.id);
    if (existing?.dirty) continue;
    const record = { ...row, dirty: false };
    state.boxes.set(record.id, record);
    toWrite.push(record);
  }
  if (toWrite.length) await db.putBoxes(toWrite);
  recountPending();
  return toWrite.length;
}

/**
 * סימון רשומות כמסונכרנות אחרי דחיפה מוצלחת.
 * @param {Array<object>} rows הגרסה הקובעת כפי שהשרת החזיר
 */
export async function markSynced(rows) {
  const toWrite = [];
  for (const row of rows) {
    const existing = state.boxes.get(row.id);
    // אם הרשומה השתנתה שוב מאז הדחיפה — משאירים אותה מלוכלכת לסבב הבא
    if (existing && existing.updatedAt > row.updatedAt) continue;
    const record = { ...row, dirty: false };
    state.boxes.set(record.id, record);
    toWrite.push(record);
  }
  if (toWrite.length) await db.putBoxes(toWrite);
  recountPending();
  notify();
}

/** כל הרשומות שממתינות לדחיפה. */
export function dirtyBoxes() {
  return [...state.boxes.values()].filter((box) => box.dirty);
}

/** עדכון מצב הסנכרון המוצג בממשק. */
export function setSyncState(partial) {
  Object.assign(state.sync, partial);
  notify();
}

/** מחיקת המטמון המקומי — משמש בהתנתקות/איפוס מכשיר. */
export async function resetLocal() {
  await db.clearBoxes();
  await db.setMeta('cursor', 0);
  await db.setMeta('numberPool', null);
  state.boxes.clear();
  recountPending();
  notify();
}
