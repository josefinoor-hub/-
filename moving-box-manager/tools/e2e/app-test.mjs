/**
 * app-test.mjs — בדיקות זרימת משתמש בדפדפן אמיתי.
 *
 * הרצה (שלושה טרמינלים, או ברקע):
 *   node tools/e2e/mock-server.mjs                     # שרת דמה, פורט 8124
 *   python3 -m http.server 8123 --directory .          # מגישים את האפליקציה
 *   node tools/e2e/app-test.mjs                        # הבדיקות
 *
 * דרישה: ‎npm install playwright‎ (כלי פיתוח בלבד — האפליקציה עצמה ללא תלויות).
 */

import { chromium } from 'playwright';

const APP = process.env.APP_URL || 'http://127.0.0.1:8123/index.html';
const API = process.env.API_URL || 'http://127.0.0.1:8124/';

const errors = [];
const step = async (name, run) => {
  try {
    await run();
    console.log('  ✓ ' + name);
  } catch (error) {
    errors.push(`[${name}] ${error.message}`);
    console.log('  ✗ ' + name + ' — ' + error.message.split('\n')[0]);
  }
};

await fetch(API + '?action=reset');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 412, height: 900 }, locale: 'he-IL' });
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') errors.push('CONSOLE: ' + message.text());
});
page.on('pageerror', (error) => errors.push('PAGEERROR: ' + error.message));

await page.goto(APP);
await page.evaluate(
  (api) =>
    localStorage.setItem(
      'mbm.settings.v1',
      JSON.stringify({
        apiUrl: api,
        token: '',
        deviceName: 'טלפון בדיקה',
        labelSize: '100x60',
        qrMode: 'text',
        thermalWidth: 58,
      })
    ),
  API
);
await page.reload();
await page.waitForTimeout(1200);

console.log('זרימת אריזה:');

await step('המסך הראשי נטען', async () => {
  await page.waitForSelector('.fab', { timeout: 5000 });
});

await step('הוספת ארגז עם חדר, תכולה וסימון שביר', async () => {
  await page.click('[data-action="add"]');
  await page.waitForSelector('.box-form');
  await page.click('.room-chip[data-room="מטבח"]');
  await page.fill('textarea[name="items"]', 'צלחות, כוסות, סירים');
  await page.locator('.toggle').filter({ hasText: 'שביר' }).click();
  await page.locator('.modal__footer .button--primary').click();
  await page.waitForSelector('.box-detail', { timeout: 5000 });
});

await step('המדבקה כוללת מספר ארגז וקוד QR', async () => {
  const number = await page.textContent('.label__number');
  if (!/BOX-\d{3}/.test(number)) throw new Error('אין מספר ארגז: ' + number);
  if ((await page.locator('.label__qr svg path').count()) < 1) throw new Error('לא נוצר QR');
});

await step('מחרוזת ה-QR מקודדת מזהה, חדר ותמצית תכולה', async () => {
  const code = await page.textContent('.detail-qr-data code');
  if (!code.includes('מטבח') || !code.includes('צלחות')) throw new Error('תוכן חסר: ' + code);
});

await page.click('.modal__close');

await step('הוספת ארגזים נוספים בחדרים שונים', async () => {
  for (const [room, items] of [['סלון', 'ספרים, אלבומים'], ['חדר נעם', 'משחקים, בגדים']]) {
    await page.click('[data-action="add"]');
    await page.waitForSelector('.box-form');
    await page.click(`.room-chip[data-room="${room}"]`);
    await page.fill('textarea[name="items"]', items);
    await page.locator('.modal__footer .button--primary').click();
    await page.waitForSelector('.box-detail');
    await page.click('.modal__close');
  }
  const cards = await page.locator('.box-card').count();
  if (cards !== 3) throw new Error(`צפויים 3 ארגזים, נמצאו ${cards}`);
});

console.log('חיפוש ותצוגה:');

await step('חיפוש לפי שם פריט', async () => {
  await page.fill('[data-role="search"]', 'אלבומים');
  await page.waitForTimeout(300);
  if ((await page.locator('.box-card').count()) !== 1) throw new Error('מספר תוצאות שגוי');
  if (!(await page.textContent('.box-card__room')).includes('סלון')) throw new Error('נמצא החדר הלא נכון');
});

await step('חיפוש לפי מספר ארגז', async () => {
  await page.fill('[data-role="search"]', '2');
  await page.waitForTimeout(300);
  const number = (await page.textContent('.box-card__number')).trim();
  if (number !== 'BOX-002') throw new Error('התקבל ' + number);
  await page.fill('[data-role="search"]', '');
  await page.waitForTimeout(300);
});

await step('מעבר בין תצוגת חדרים לרשימה מלאה', async () => {
  await page.click('[data-mode="list"]');
  await page.waitForTimeout(200);
  if ((await page.locator('.room-section').count()) !== 0) throw new Error('עדיין מקובץ לפי חדרים');
  await page.click('[data-mode="rooms"]');
  await page.waitForTimeout(200);
  if ((await page.locator('.room-section').count()) !== 3) throw new Error('חסרות קבוצות חדרים');
});

console.log('סנכרון:');

await step('הארגזים נדחפו לשרת עם מספור תקין', async () => {
  await page.waitForFunction(() => document.querySelector('.sync-chip')?.dataset.status === 'synced', {
    timeout: 8000,
  });
  const response = await fetch(API + '?action=pull&since=0').then((r) => r.json());
  if (response.boxes.length !== 3) throw new Error(`בשרת ${response.boxes.length} ארגזים`);
  if (!response.boxes.every((box) => /^BOX-\d{3}$/.test(box.boxNumber))) throw new Error('מספור שגוי');
});

await step('שינוי ממכשיר אחר מגיע לאפליקציה', async () => {
  await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      action: 'push',
      boxes: [
        {
          id: 'remote-1',
          number: 90,
          boxNumber: 'BOX-090',
          room: 'מרפסת',
          items: ['כיסאות גינה'],
          fragile: false,
          priority: 'high',
          notes: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deleted: false,
          updatedBy: 'טאבלט',
        },
      ],
    }),
  });
  await page.waitForFunction(() => document.body.innerText.includes('BOX-090'), { timeout: 12000 });
});

await step('התנגשות: העריכה המאוחרת מנצחת', async () => {
  // מכוון לארגז שנוצר מרחוק בלבד: הבדיקה חותמת עליו זמן עתידי, ולכן אסור
  // שישמש בהמשך לבדיקות עריכה ומחיקה — הן היו נדחות בצדק כגרסה ישנה יותר.
  const response = await fetch(API + '?action=pull&since=0').then((r) => r.json());
  const target = response.boxes.find((box) => box.id === 'remote-1');
  await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      action: 'push',
      boxes: [
        {
          ...target,
          items: ['עודכן מהטאבלט'],
          updatedAt: new Date(Date.now() + 60000).toISOString(),
          updatedBy: 'טאבלט',
        },
      ],
    }),
  });
  await page.waitForFunction(() => document.body.innerText.includes('עודכן מהטאבלט'), { timeout: 12000 });
});

console.log('הדפסה, עריכה ומחיקה:');

await step('הדפסת חדר בונה מדבקות באזור ההדפסה', async () => {
  await page.evaluate(() => {
    window.print = () => {
      window.__printed = true;
    };
  });
  await page.click('.room-section:has-text("מרפסת") [data-action="print-room"]');
  await page.waitForTimeout(400);
  if ((await page.locator('#print-root .label').count()) !== 1) throw new Error('מספר מדבקות שגוי');
  if (!(await page.evaluate(() => window.__printed))) throw new Error('window.print לא נקרא');
});

await step('סורק ללא תמיכה בדפדפן מציג הקלדה ידנית', async () => {
  await page.evaluate(() => {
    delete window.BarcodeDetector;
  });
  await page.click('[data-action="scan"]');
  await page.waitForSelector('.scanner__manual');
  await page.waitForFunction(() => document.querySelector('.scanner__hint--error'), { timeout: 4000 });
  await page.fill('.scanner__manual input', '1');
  await page.click('.scanner__manual button');
  await page.waitForSelector('.box-detail', { timeout: 4000 });
  const title = (await page.textContent('.modal__title')).trim();
  if (title !== 'BOX-001') throw new Error('נפתח ' + title);
});

await step('עריכת ארגז מסתנכרנת', async () => {
  await page.click('.modal__footer .button--ghost:has-text("עריכה")');
  await page.waitForSelector('.box-form');
  await page.fill('textarea[name="items"]', 'צלחות, כוסות, קערות חדשות');
  await page.click('.modal__footer .button--primary');
  await page.waitForSelector('.box-detail');
  await page.waitForTimeout(2500);
  const response = await fetch(API + '?action=pull&since=0').then((r) => r.json());
  const box = response.boxes.find((entry) => entry.boxNumber === 'BOX-001');
  if (!box.items.includes('קערות חדשות')) throw new Error('העריכה לא הגיעה לשרת');
});

await step('מחיקה מסונכרנת כמחיקה רכה', async () => {
  await page.click('.modal__footer .button--danger-ghost');
  await page.waitForSelector('.modal--sm');
  await page.click('.modal--sm .button--danger');
  await page.waitForTimeout(2500);
  const response = await fetch(API + '?action=pull&since=0').then((r) => r.json());
  const box = response.boxes.find((entry) => entry.boxNumber === 'BOX-001');
  if (!box.deleted) throw new Error('לא סומן כמחוק בשרת');
  if (await page.locator('.box-card:has-text("BOX-001")').count()) throw new Error('עדיין מוצג ברשימה');
});

console.log('הגדרות וייצוא:');

await step('מסך ההגדרות מציג מצב סנכרון ומאגר מספרים', async () => {
  await page.click('[data-action="settings"]');
  await page.waitForSelector('.settings');
  const status = await page.textContent('[data-role="sync-status"]');
  if (!/מסונכרן|מסנכרן/.test(status)) throw new Error('סטטוס: ' + status.trim());
  if (!/\d+/.test(await page.textContent('[data-role="pool"]'))) throw new Error('אין מידע על מאגר מספרים');
});

await step('קוד QR לחיבור מכשיר נוסף נוצר', async () => {
  await page.click('[data-action="share"]');
  await page.waitForSelector('.share-qr svg');
  if ((await page.locator('.share-qr svg path').count()) < 1) throw new Error('לא נוצר QR');
  await page.click('.modal__footer .button--primary');
});

await step('ייצוא CSV מוריד קובץ עם הארגזים', async () => {
  await page.click('[data-action="settings"]');
  await page.waitForSelector('.settings');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.click('[data-action="export"]'),
  ]);
  const stream = await download.createReadStream();
  let text = '';
  for await (const chunk of stream) text += chunk;
  if (!text.includes('מספר ארגז') || !text.includes('BOX-')) throw new Error('תוכן CSV שגוי');
  await page.click('.modal__close');
});

await browser.close();

console.log(errors.length ? `\nשגיאות (${errors.length}):\n` + errors.join('\n') : '\nכל הבדיקות עברו ✓');
process.exit(errors.length ? 1 : 0);
