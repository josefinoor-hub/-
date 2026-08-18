/**
 * numbers.js — הקצאת מספרי ארגז רציפים ללא התנגשויות.
 *
 * הבעיה: המספור חייב להיות רציף (BOX-001, BOX-002...) אבל אריזה מתבצעת גם
 * בלי קליטה, ושני מכשירים עלולים ליצור ארגז באותו רגע.
 *
 * הפתרון: כל מכשיר משריין מראש בלוק מספרים מהשרת (למשל 41–80). היצירה
 * המקומית שולפת מהבלוק ולכן מקבלת מספר סופי מיד, גם ללא רשת, והמדבקה
 * ניתנת להדפסה על המקום. הבלוק מתמלא מחדש אוטומטית כשהוא מתקרב לסופו.
 *
 * לפני שהאפליקציה חוברה לגיליון כלל, אין עם מי להתנגש — ולכן המספור נעשה
 * מקומית לפי המספר הגבוה שכבר קיים במכשיר. כך אפשר להתחיל לארוז ולהדפיס
 * מדבקות מיד, וההגדרה מול Google נשארת שלב שאפשר לעשות אחר כך.
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

/** המספר הבא בהמשך למה שכבר קיים במכשיר — לשימוש כשאין גיליון משותף. */
async function nextLocalNumber() {
  const boxes = await db.getAllBoxes();
  let max = 0;
  for (const box of boxes) {
    if (Number.isFinite(box.number) && box.number > max) max = box.number;
  }
  return max + 1;
}

/**
 * שליפת המספר הפנוי הבא. מחזיר null רק במקרה הקצה שבו האפליקציה כבר
 * מחוברת לגיליון, מאגר המספרים התרוקן ואין רשת לחדש אותו — אז השרת
 * ישבץ מספר בסנכרון הבא.
 */
export async function allocate() {
  // עוד לא חוברנו לגיליון: אין מכשיר אחר שעלול לתפוס את אותו מספר
  if (!isConfigured()) return nextLocalNumber();

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
