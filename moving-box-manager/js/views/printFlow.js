/**
 * views/printFlow.js — הדפסה במדפסת המדבקות, עם משוב למשתמש.
 *
 * כל מקום בממשק שמדפיס ל-Bluetooth עובר דרך כאן, כדי שההתנהגות תהיה אחידה:
 * הודעה ברורה כשהדפדפן אינו תומך, התקדמות על הכפתור, ושגיאות המדפסת
 * (נגמרו המדבקות, מכסה פתוח) מוצגות כלשונן.
 */

import * as printer from '../printer.js';
import { toast } from '../dialogs.js';

/**
 * @param {object|object[]} boxes
 * @param {{button?: HTMLButtonElement}} [options] כפתור שיציג את ההתקדמות
 * @returns {Promise<boolean>} האם ההדפסה הושלמה
 */
export async function printOnLabelPrinter(boxes, { button } = {}) {
  const list = [].concat(boxes).filter(Boolean);
  if (!list.length) return false;

  if (!printer.isSupported()) {
    toast('הדפסה ב-Bluetooth פועלת ב-Chrome באנדרואיד. בדפדפן הזה אפשר להשתמש ב"הדפסה רגילה / PDF".', {
      type: 'error',
      duration: 7000,
    });
    return false;
  }

  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = printer.isConnected() ? 'מדפיס…' : 'מתחבר למדפסת…';
  }

  try {
    await printer.printBoxes(list, {
      onProgress: (done, total) => {
        if (button && total > 1) button.textContent = `מדפיס ${done} מתוך ${total}…`;
      },
    });
    toast(
      list.length === 1
        ? `המדבקה נשלחה ל-${printer.connectedName() || printer.typeLabel()}`
        : `${list.length} מדבקות נשלחו למדפסת`,
      { type: 'success' }
    );
    return true;
  } catch (error) {
    // NotFoundError: המשתמש סגר את חלון בחירת המדפסת בלי לבחור
    if (error?.name === 'NotFoundError') toast('לא נבחרה מדפסת', { duration: 2500 });
    else toast(error?.message || 'ההדפסה נכשלה', { type: 'error', duration: 7000 });
    return false;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

/** ארגז לדוגמה להדפסת בדיקה — אינו נשמר ברשימה. */
export function sampleBox() {
  const now = new Date().toISOString();
  return {
    id: 'sample',
    number: 0,
    boxNumber: 'BOX-000',
    room: 'בדיקת הדפסה',
    items: ['המדפסת מחוברת ועובדת'],
    fragile: true,
    priority: 'normal',
    notes: '',
    createdAt: now,
    updatedAt: now,
    deleted: false,
  };
}
