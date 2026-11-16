/**
 * app.js — נקודת הכניסה. מחברת בין המטמון, מנוע הסנכרון והממשק.
 */

import * as db from './db.js';
import * as store from './store.js';
import * as sync from './sync.js';
import * as numbers from './numbers.js';
import { mount } from './ui.js';
import { clearPrintRoot } from './label.js';
import { adoptSettingsFromUrl, isConfigured } from './settings.js';
import { openSettings } from './views/settings.js';
import { toast } from './dialogs.js';

async function main() {
  const root = document.getElementById('app');

  if (!db.isSupported()) {
    root.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">⚠️</div>
        <h2>הדפדפן אינו נתמך</h2>
        <p>האפליקציה זקוקה לאחסון מקומי (IndexedDB). נסו בכרום או בדפדפן עדכני אחר.</p>
      </div>`;
    return;
  }

  // רישום מוקדם ככל האפשר, כדי שהמטמון לעבודה ללא רשת יתחיל להיבנות מיד
  registerServiceWorker();

  // חיבור מכשיר חדש דרך קוד QR של שיתוף הגדרות
  const adopted = adoptSettingsFromUrl();

  mount(root);
  await store.init();
  sync.start();
  numbers.refill();

  if (adopted) toast('המכשיר חובר לגיליון המשפחתי', { type: 'success' });
  else if (!isConfigured()) {
    // הפעלה ראשונה — פותחים ישר את מסך החיבור
    setTimeout(() => openSettings(), 400);
  }

  // ניקוי אזור ההדפסה אחרי סגירת דיאלוג ההדפסה של המערכת
  window.addEventListener('afterprint', clearPrintRoot);
}

/**
 * רישום ה-Service Worker שאחראי לעבודה ללא רשת.
 * נקרא ישירות ולא בתוך מאזין ל-load: הסקריפט נטען כמודול (defer), ולכן
 * ייתכן ש-load כבר קרה — מאזין שנרשם אחרי כן לא היה מופעל לעולם.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    navigator.serviceWorker
      .register(new URL('../sw.js', import.meta.url), { scope: './' })
      .catch((error) => console.warn('רישום Service Worker נכשל', error));
  } catch (error) {
    // למשל כשהדף מוגש כקובץ בודד ואין לצדו sw.js — האפליקציה עובדת בלעדיו
    console.warn('אין Service Worker זמין', error);
  }
}

main().catch((error) => {
  console.error('טעינת האפליקציה נכשלה', error);
  toast('טעינת האפליקציה נכשלה. רעננו את הדף.', { type: 'error', duration: 6000 });
});
