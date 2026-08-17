/**
 * numbers.js — הקצאת מספרי ארגז רציפים ללא התנגשויות.
 *
 * הבעיה: המספור חייב להיות רציף (BOX-001, BOX-002...) אבל אריזה מתבצעת גם
 * בלי קליטה, ושני מכשירים עלולים ליצור ארגז באותו רגע.
 *
 * הפתרון: כל מכשיר משריין מראש בלוק מספרים מהשרת (למשל 41–80). היצירה
 * המקומית שולפת מהבלוק ולכן מקבלת מספר סופי מיד, גם ללא רשת, והמדבקה
 * ניתנת להדפסה על המקום. הבלוק מתמלא מחדש אוטומטית כשהוא מתקרב לסופו.
 */

import { SYNC } from './config.js';
import * as api from './api.js';
import * as db from './db.js';
import { isConfigured } from './settings.js';

const META_KEY = 'numberPool';
let refillPromise = null;

async function readPool() {
  const pool = await db.getMeta(META_KEY, null);
  return pool && Array.isArray(pool.ranges) ? pool : { ranges: [] };
}

function countAvailable(pool) {
  return pool.ranges.reduce((sum, [from, to]) => sum + Math.max(0, to - from + 1), 0);
}

/** כמה מספרים שמורים עדיין זמינים במכשיר. */
export async function available() {
  return countAvailable(await readPool());
}

/**
 * שליפת המספר הפנוי הבא. מחזיר null כשאין מלאי ואין רשת —
 * במקרה כזה הארגז נשמר בלי מספר והשרת ישבץ לו מספר בסנכרון הבא.
 */
export async function allocate() {
  const pool = await readPool();
  const range = pool.ranges.find(([from, to]) => from <= to);
  if (!range) {
    void refill();
    return null;
  }

  const number = range[0];
  range[0] += 1;
  pool.ranges = pool.ranges.filter(([from, to]) => from <= to);
  await db.setMeta(META_KEY, pool);

  if (countAvailable(pool) < SYNC.NUMBER_POOL_REFILL_THRESHOLD) void refill();
  return number;
}

/**
 * מילוי מחדש של מאגר המספרים מהשרת. שקט בכוונה: כישלון כאן אינו שגיאה
 * שמוצגת למשתמש, אלא רק דחייה של המילוי לניסיון הבא.
 */
export function refill() {
  if (refillPromise) return refillPromise;
  if (!isConfigured() || !navigator.onLine) return Promise.resolve(false);

  refillPromise = (async () => {
    try {
      const pool = await readPool();
      if (countAvailable(pool) >= SYNC.NUMBER_POOL_REFILL_THRESHOLD) return false;

      const response = await api.reserveNumbers(SYNC.NUMBER_POOL_SIZE);
      if (!Number.isFinite(response.from) || !Number.isFinite(response.to)) return false;

      pool.ranges.push([response.from, response.to]);
      pool.ranges.sort((a, b) => a[0] - b[0]);
      await db.setMeta(META_KEY, pool);
      return true;
    } catch (error) {
      console.debug('שריון מספרים נדחה', error.message);
      return false;
    } finally {
      refillPromise = null;
    }
  })();

  return refillPromise;
}

/** איפוס המאגר — למשל אחרי החלפת גיליון. */
export function reset() {
  return db.setMeta(META_KEY, { ranges: [] });
}
