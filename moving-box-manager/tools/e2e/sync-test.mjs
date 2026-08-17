/**
 * sync-test.mjs — בדיקות למנוע הסנכרון ולעבודה ללא רשת.
 *
 * שתי הבדיקות כאן מכסות את שני הכשלים שהכי קשה לאתר ידנית:
 *   1. קידום שגוי של סמן הסנכרון, שגורם לשינוי ממכשיר אחר להיעלם לתמיד.
 *   2. אפליקציה שאינה נטענת בלי רשת.
 *
 * הרצה: ראו את ההוראות בראש app-test.mjs.
 */

import { chromium } from 'playwright';

const APP = process.env.APP_URL || 'http://127.0.0.1:8123/index.html';
const API = process.env.API_URL || 'http://127.0.0.1:8124/';

const errors = [];
const report = (ok, message) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + message);
  if (!ok) errors.push(message);
};

const SETTINGS = (api) =>
  JSON.stringify({ apiUrl: api, deviceName: 'מכשיר בדיקה', labelSize: '100x60', qrMode: 'text' });

// ---------------------------------------------------------------------------
// 1. הסמן אינו מדלג על שינוי שנכתב בין המשיכה לדחיפה
// ---------------------------------------------------------------------------

console.log('סמן הסנכרון:');
await fetch(API + '?action=reset');
{
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 900 }, locale: 'he-IL' });
  await page.goto(APP);
  await page.evaluate((settings) => localStorage.setItem('mbm.settings.v1', settings), SETTINGS(API));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.sync-chip')?.dataset.status === 'synced', {
    timeout: 15000,
  });

  const marker = 'סימן-' + Date.now();
  const result = await page.evaluate(
    async ({ api, marker }) => {
      const sync = await import('./js/sync.js');
      const store = await import('./js/store.js');
      const { createBox } = await import('./js/boxes.js');

      sync.stop(); // עוצרים את הסבב המחזורי — התרחיש נשלט ידנית
      await sync.syncNow({ reason: 'test' });

      // מכשיר אחר כותב שינוי...
      await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'push',
          boxes: [
            {
              id: 'remote-' + marker,
              number: 800,
              boxNumber: 'BOX-800',
              room: 'מטבח',
              items: [marker],
              fragile: false,
              priority: 'normal',
              notes: '',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              deleted: false,
              updatedBy: 'מכשיר ב',
            },
          ],
        }),
      });

      // ...ומיד אחריו המכשיר הזה דוחף שינוי משלו
      await store.saveLocal(createBox({ room: 'סלון', items: 'שינוי מקומי', device: 'מכשיר א' }));
      await sync.syncNow({ reason: 'test' });

      return [...store.state.boxes.values()].some((box) => (box.items || []).includes(marker));
    },
    { api: API, marker }
  );

  report(result, 'שינוי מרוחק נקלט למרות דחיפה מקבילה');
  await browser.close();
}

// ---------------------------------------------------------------------------
// 2. עבודה מלאה ללא רשת
// ---------------------------------------------------------------------------

console.log('עבודה ללא רשת:');
await fetch(API + '?action=reset');
{
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 412, height: 900 }, locale: 'he-IL' });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push('PAGEERROR: ' + error.message));

  await page.goto(APP);
  await page.evaluate((settings) => localStorage.setItem('mbm.settings.v1', settings), SETTINGS(API));
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 });
  report(true, 'Service Worker נרשם והשתלט על הדף');

  // יוצרים ארגז אחד כשיש רשת
  await page.click('[data-action="add"]');
  await page.waitForSelector('.box-form');
  await page.click('.room-chip[data-room="סלון"]');
  await page.fill('textarea[name="items"]', 'ספרים');
  await page.click('.modal__footer .button--primary');
  await page.waitForSelector('.box-detail');
  await page.click('.modal__close');
  await page.waitForTimeout(2000);
  const before = await page.locator('.box-card').count();

  // ניתוק מלא ורענון קר
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('.fab', { timeout: 10000 });
  report(true, 'האפליקציה נטענת מחדש ללא רשת');

  const after = await page.locator('.box-card').count();
  report(after === before, `כל ${before} הארגזים זמינים אופליין`);

  // יצירת ארגז והדפסת מדבקה ללא רשת
  await page.click('[data-action="add"]');
  await page.waitForSelector('.box-form');
  await page.click('.room-chip[data-room="מטבח"]');
  await page.fill('textarea[name="items"]', 'סירים');
  await page.click('.modal__footer .button--primary');
  await page.waitForSelector('.box-detail');
  const number = (await page.textContent('.label__number')).trim();
  const qrPaths = await page.locator('.label__qr svg path').count();
  report(/^BOX-\d{3}$/.test(number) && qrPaths > 0, `ארגז חדש (${number}) עם QR מוכן להדפסה ללא רשת`);
  await page.click('.modal__close');

  report((await page.getAttribute('.sync-chip', 'data-status')) === 'offline', 'מחוון הסנכרון מציג מצב לא-מקוון');

  // חזרה לרשת — הארגז שנוצר אופליין מסתנכרן לבדו
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(3000);
  const server = await fetch(API + '?action=pull&since=0').then((r) => r.json());
  report(
    server.boxes.some((box) => (box.items || []).includes('סירים')),
    'הארגז שנוצר אופליין הסתנכרן עם חזרת הרשת'
  );

  await browser.close();
}

console.log(errors.length ? `\nשגיאות (${errors.length}):\n` + errors.join('\n') : '\nכל הבדיקות עברו ✓');
process.exit(errors.length ? 1 : 0);
