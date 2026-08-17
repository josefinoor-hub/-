/**
 * sync.js — מנוע הסנכרון הדו־כיווני מול הגיליון בענן.
 *
 * העיקרון: המטמון המקומי הוא מקור האמת של הממשק, והשרת הוא מקור האמת
 * המשותף. כל שינוי מקומי נשמר מיד ונדחף ברקע; כל שינוי מרוחק נמשך במחזוריות
 * קצרה (ומיד עם חזרה למסך או לרשת), כך שהמכשירים מתיישרים תוך שניות.
 *
 * יישוב התנגשויות: הרשומה בעלת חותמת העדכון המאוחרת מנצחת (Last-Write-Wins),
 * וההכרעה מתבצעת בשרת כדי שכל המכשירים יגיעו לאותה תוצאה.
 */

import { SYNC } from './config.js';
import * as api from './api.js';
import * as db from './db.js';
import * as store from './store.js';
import * as numbers from './numbers.js';
import { isConfigured } from './settings.js';
import { debounce } from './util.js';

let pollTimer = null;
let started = false;
let inFlight = null;
let failureStreak = 0;

function currentInterval() {
  if (document.visibilityState === 'hidden') return SYNC.BACKGROUND_POLL_INTERVAL_MS;
  return SYNC.POLL_INTERVAL_MS;
}

function scheduleNext(delayMs = currentInterval()) {
  clearTimeout(pollTimer);
  if (!started) return;
  pollTimer = setTimeout(() => {
    syncNow({ reason: 'poll' });
  }, delayMs);
}

/** השהיה גדלה והולכת אחרי כשלי רשת רצופים, עד לתקרה. */
function backoffDelay() {
  const delay = SYNC.RETRY_BASE_MS * 2 ** Math.min(failureStreak, 5);
  return Math.min(delay, SYNC.RETRY_MAX_MS);
}

/**
 * סבב סנכרון יחיד: קודם דוחפים שינויים מקומיים (כדי שהשרת יכריע ויקצה
 * מספרים), ואז מושכים את כל מה שהתחדש מאז הסמן האחרון.
 */
export function syncNow({ reason = 'manual' } = {}) {
  if (inFlight) return inFlight;

  if (!isConfigured()) {
    store.setSyncState({ status: 'unconfigured', error: '' });
    return Promise.resolve(false);
  }
  if (!navigator.onLine) {
    store.setSyncState({ status: 'offline', error: '' });
    scheduleNext();
    return Promise.resolve(false);
  }

  inFlight = (async () => {
    store.setSyncState({ status: 'syncing', error: '' });
    try {
      await pushDirty();
      await pullChanges();
      await numbers.refill();

      failureStreak = 0;
      store.setSyncState({
        status: 'synced',
        lastSyncAt: new Date().toISOString(),
        error: '',
      });
      scheduleNext();
      return true;
    } catch (error) {
      failureStreak++;
      const offline = error.network || !navigator.onLine;
      store.setSyncState({
        status: offline ? 'offline' : 'error',
        error: offline ? '' : error.message,
      });
      scheduleNext(backoffDelay());
      if (!offline) console.warn(`סנכרון (${reason}) נכשל:`, error);
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** דחיפת כל הרשומות שממתינות, וקליטת הגרסה שהשרת הכריע עליה. */
async function pushDirty() {
  const pending = store.dirtyBoxes();
  if (!pending.length) return;

  // שולחים בלי שדות פנימיים של המטמון
  const payload = pending.map(({ dirty, ...box }) => box);
  const response = await api.push(payload);
  if (Array.isArray(response.boxes)) await store.markSynced(response.boxes);

  // הסמן מתקדם רק במשיכה, לעולם לא כאן: הסמן שהדחיפה מחזירה כבר כולל את
  // הכתיבות שלנו, ולכן קידום שלו כאן היה מדלג על שינויים שמכשיר אחר כתב
  // בין המשיכה האחרונה לדחיפה הזו — והם לא היו מגיעים למכשיר לעולם.
}

/** משיכת השינויים שנעשו בשאר המכשירים מאז הסמן האחרון. */
async function pullChanges() {
  const since = (await db.getMeta('cursor', 0)) || 0;
  const response = await api.pull(since);
  if (Array.isArray(response.boxes) && response.boxes.length) {
    await store.applyRemote(response.boxes);
    store.notify();
  }
  if (Number.isFinite(response.cursor)) await db.setMeta('cursor', response.cursor);
}

/** דחיפה מהירה אחרי עריכה, עם איגוד הקלדות רצופות. */
const pushSoon = debounce(() => syncNow({ reason: 'local-change' }), SYNC.PUSH_DEBOUNCE_MS);

/** הפעלת המנוע: סבב ראשוני, מחזוריות, והאזנה לאירועי רשת ומיקוד. */
export function start() {
  if (started) return;
  started = true;

  store.onDirty(() => pushSoon());

  window.addEventListener('online', () => {
    failureStreak = 0;
    syncNow({ reason: 'online' });
  });
  window.addEventListener('offline', () => store.setSyncState({ status: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow({ reason: 'visible' });
    else scheduleNext();
  });
  // דחיפה אחרונה לפני שהדף נסגר, כדי לא להשאיר שינוי תקוע במכשיר
  window.addEventListener('pagehide', () => pushSoon.flush());

  syncNow({ reason: 'startup' });
}

export function stop() {
  started = false;
  clearTimeout(pollTimer);
}

/** משיכה מלאה מאפס — לשימוש אחרי חיבור לגיליון אחר. */
export async function resyncFromScratch() {
  await db.setMeta('cursor', 0);
  return syncNow({ reason: 'resync' });
}
