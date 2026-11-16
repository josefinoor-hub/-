/**
 * niimbot-test.mjs — בדיקת ההדפסה ל-NIIMBOT B1 מול מדפסת מדומה.
 *
 * אין דרך לחבר מדפסת אמיתית לבדיקה אוטומטית, ולכן הדפדפן מקבל מכשיר
 * Bluetooth מדומה שמתנהג לפי הפרוטוקול של NIIMBOT: הוא מאמת כל הודעה
 * (כותרת, סכום ביקורת, סיומת), עונה כמו המדפסת, ומשחזר מהשורות שקיבל את
 * התמונה שהייתה מודפסת. כך נבדק שהבתים שנשלחים באמת מרכיבים את המדבקה.
 *
 * הרצה: ראו את ההוראות בראש app-test.mjs.
 * עם OUT_DIR=<תיקייה> התמונות המשוחזרות נשמרות כקובצי PBM לבדיקה בעין
 * או לפענוח קוד ה-QR בכלי חיצוני.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = process.env.APP_URL || 'http://127.0.0.1:8123/index.html';
const OUT_DIR = process.env.OUT_DIR || '';

const errors = [];
const report = (ok, message) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + message);
  if (!ok) errors.push(message);
};

/** מותקן בדף לפני טעינת האפליקציה: מכשיר Bluetooth מדומה. */
function installFakePrinter() {
  const printer = {
    packets: [],        // כל ההודעות שהתקבלו, לפי הסדר
    problems: [],       // הפרות פרוטוקול שהמדפסת המדומה זיהתה
    pages: [],          // התמונות ששוחזרו: { width, height, rows: string[] }
    current: null,
    printed: 0,
    failWith: null,     // קוד שגיאה להחזיר בסוף העמוד, לבדיקת טיפול בשגיאות
    requestOptions: null,
  };
  window.__printer = printer;

  const characteristic = new EventTarget();
  characteristic.properties = { notify: true, writeWithoutResponse: true, write: false };
  characteristic.startNotifications = async () => characteristic;

  const reply = (command, data, { split = false } = {}) => {
    let checksum = command ^ data.length;
    for (const byte of data) checksum ^= byte;
    const bytes = [0x55, 0x55, command, data.length, ...data, checksum & 0xff, 0xaa, 0xaa];
    // חלק מהתשובות נשלחות בשני חלקים, כדי לוודא שהמפענח מרכיב אותן
    const chunks = split ? [bytes.slice(0, 3), bytes.slice(3)] : [bytes];
    chunks.forEach((chunk, index) => {
      setTimeout(() => {
        characteristic.value = new DataView(Uint8Array.from(chunk).buffer);
        characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
      }, 1 + index * 2);
    });
  };

  const countThirds = (row) => {
    const counts = [0, 0, 0];
    row.forEach((byte, index) => {
      let bits = 0;
      for (let value = byte; value; value >>= 1) bits += value & 1;
      counts[Math.min(2, Math.floor(index / 16))] += bits;
    });
    return counts.map((count) => Math.min(255, count));
  };

  characteristic.writeValueWithoutResponse = async (value) => {
    let bytes = Array.from(value instanceof Uint8Array ? value : new Uint8Array(value.buffer || value));
    if (bytes[0] === 0x03) bytes = bytes.slice(1); // הקידומת של פקודת ההתחברות

    const command = bytes[2];
    const length = bytes[3];
    const data = bytes.slice(4, 4 + length);
    let checksum = command ^ length;
    for (const byte of data) checksum ^= byte;

    if (bytes[0] !== 0x55 || bytes[1] !== 0x55) printer.problems.push('כותרת שגויה');
    if (bytes.length !== length + 7) printer.problems.push(`אורך שגוי בפקודה 0x${command.toString(16)}`);
    if (bytes[4 + length] !== (checksum & 0xff)) printer.problems.push(`סכום ביקורת שגוי בפקודה 0x${command.toString(16)}`);
    if (bytes[5 + length] !== 0xaa || bytes[6 + length] !== 0xaa) printer.problems.push('סיומת שגויה');

    printer.packets.push({ command, data });
    const u16 = (offset) => (data[offset] << 8) | data[offset + 1];

    switch (command) {
      case 0xc1: return reply(0xc2, [1]);
      case 0x21: return reply(0x31, [1]);
      case 0x23: return reply(0x33, [1]);
      case 0x01:
        if (length !== 7) printer.problems.push('התחלת הדפסה ל-B1 חייבת להיות באורך 7');
        printer.expectedPages = u16(0);
        return reply(0x02, [1]);
      case 0x03: return reply(0x04, [1]);
      case 0x13:
        if (length !== 6) printer.problems.push('מידות עמוד ל-B1 חייבות להיות באורך 6');
        printer.current = { height: u16(0), width: u16(2), rows: [] };
        if (printer.current.width % 8) printer.problems.push('רוחב שאינו מתחלק ב-8');
        if (printer.current.width > 384) printer.problems.push('רוחב גדול מראש ההדפסה');
        return reply(0x14, [1]);
      case 0x84: {
        const [row, repeats] = [u16(0), data[2]];
        if (row !== printer.current.rows.length) printer.problems.push(`שורה ריקה מחוץ לרצף: ${row}`);
        for (let i = 0; i < repeats; i++) printer.current.rows.push('0'.repeat(printer.current.width));
        return;
      }
      case 0x85: {
        const row = u16(0);
        const counts = data.slice(2, 5);
        const repeats = data[5];
        const bits = data.slice(6);
        if (row !== printer.current.rows.length) printer.problems.push(`שורה מחוץ לרצף: ${row}`);
        if (bits.length !== printer.current.width / 8) printer.problems.push(`אורך שורה שגוי: ${bits.length}`);
        if (countThirds(bits).join() !== counts.join()) printer.problems.push(`ספירת נקודות שגויה בשורה ${row}`);
        const text = bits.map((byte) => byte.toString(2).padStart(8, '0')).join('');
        for (let i = 0; i < repeats; i++) printer.current.rows.push(text);
        return;
      }
      case 0xe3:
        if (printer.failWith) return reply(0xdb, [printer.failWith]);
        if (printer.current.rows.length !== printer.current.height) {
          printer.problems.push(`התקבלו ${printer.current.rows.length} שורות מתוך ${printer.current.height}`);
        }
        printer.pages.push(printer.current);
        printer.printed += 1;
        return reply(0xe4, [1]);
      case 0xa3: return reply(0xb3, [printer.printed >> 8, printer.printed & 0xff, 100, 100], { split: true });
      case 0xf3:
        printer.ended = (printer.ended || 0) + 1;
        return reply(0xf4, [1]);
      default:
        printer.problems.push(`פקודה לא מוכרת 0x${command.toString(16)}`);
    }
  };

  const device = new EventTarget();
  device.name = 'B1-H819030123';
  device.gatt = {
    connected: false,
    async connect() {
      device.gatt.connected = true;
      return {
        getPrimaryService: async () => ({ getCharacteristics: async () => [characteristic] }),
        getPrimaryServices: async () => [{ getCharacteristics: async () => [characteristic] }],
      };
    },
    disconnect() {
      device.gatt.connected = false;
    },
  };

  Object.defineProperty(navigator, 'bluetooth', {
    configurable: true,
    value: {
      requestDevice: async (options) => {
        printer.requestOptions = options;
        return device;
      },
    },
  });
}

const BOXES = [
  { number: 1, room: 'מטבח', items: 'קומקום, טוסטר, סירים, מחבתות', fragile: true, priority: 'normal' },
  { number: 14, room: 'ארונות בגדים חדר שינה', items: 'מעילים, סוודרים, צעיפים, כובעים', fragile: false, priority: 'high' },
  { number: 137, room: 'פינת מחשב יוסי', items: 'מסך, מקלדת, כבלים', fragile: true, priority: 'high' },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 900 }, locale: 'he-IL' });
page.on('pageerror', (error) => errors.push('PAGEERROR: ' + error.message));
await page.addInitScript(installFakePrinter);
await page.goto(APP);
await page.waitForSelector('.fab');

console.log('בניית הודעות:');
const packets = await page.evaluate(async () => {
  const niimbot = await import('./js/niimbot.js');
  const hex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    connect: hex(niimbot.buildPacket(niimbot.COMMAND.CONNECT, [1])),
    density: hex(niimbot.buildPacket(niimbot.COMMAND.SET_DENSITY, [3])),
    size5030: niimbot.labelDots('50x30'),
    size4020: niimbot.labelDots('40x20'),
  };
});
report(packets.connect === '035555c10101c1aaaa', `פקודת התחברות: ${packets.connect}`);
report(packets.density === '555521010323aaaa', `פקודת כהות: ${packets.density}`);
report(packets.size5030.widthDots === 384 && packets.size5030.heightDots === 240, 'מדבקת 50×30 = 384×240 נקודות');
report(packets.size4020.widthDots === 320 && packets.size4020.heightDots === 160, 'מדבקת 40×20 = 320×160 נקודות');

for (const labelId of ['50x30', '40x30', '40x20', '50x50', '40x60']) {
  console.log(`הדפסה על מדבקת ${labelId}:`);
  const result = await page.evaluate(
    async ({ boxes, labelId }) => {
      const niimbot = await import('./js/niimbot.js');
      const { createBox } = await import('./js/boxes.js');
      const printer = window.__printer;
      printer.packets = [];
      printer.pages = [];
      printer.problems = [];
      printer.printed = 0;
      printer.ended = 0;

      const list = boxes.map((box) => createBox({ ...box, device: 'בדיקה' }));
      const progress = [];
      const sent = await niimbot.printBoxes(list, { labelId, density: 3, onProgress: (done) => progress.push(done) });
      return {
        sent,
        progress,
        problems: printer.problems,
        pages: printer.pages,
        order: printer.packets.map((packet) => packet.command).filter((command) => command !== 0x85 && command !== 0x84 && command !== 0xa3),
        imagePackets: printer.packets.filter((packet) => packet.command === 0x85 || packet.command === 0x84).length,
        ended: printer.ended,
        expectedPages: printer.expectedPages,
        filters: printer.requestOptions?.filters?.length,
        service: printer.requestOptions?.optionalServices?.[0],
      };
    },
    { boxes: BOXES, labelId }
  );

  report(result.problems.length === 0, result.problems.length ? 'הפרות פרוטוקול: ' + result.problems.join('; ') : 'כל ההודעות תקינות (כותרת, אורך, סכום ביקורת, ספירת נקודות)');
  report(result.sent === 3 && result.pages.length === 3 && result.expectedPages === 3, `הודפסו ${result.pages.length} מדבקות מתוך 3`);
  report(result.progress.join() === '1,2,3', 'דיווח התקדמות אחרי כל מדבקה');
  report(result.ended === 1, 'משימת ההדפסה נסגרה פעם אחת');

  const page0 = result.pages[0];
  const expected = await page.evaluate(async (id) => (await import('./js/niimbot.js')).labelDots(id), labelId);
  report(
    page0.width === Math.floor(expected.widthDots / 8) * 8 && page0.height === expected.heightDots,
    `גודל התמונה ${page0.width}×${page0.height} נקודות`
  );
  const totalRows = page0.height * 3;
  report(result.imagePackets < totalRows, `דחיסת שורות: ${result.imagePackets} הודעות במקום ${totalRows}`);

  // סדר הפקודות: הגדרות, התחלה, ולכל עמוד — התחלה, מידות, סוף; ובסוף סגירה
  const perPage = [0x03, 0x13, 0xe3];
  const expectedOrder = [0x21, 0x23, 0x01, ...perPage, ...perPage, ...perPage, 0xf3];
  const order = result.order.filter((command) => command !== 0xc1);
  report(order.join() === expectedOrder.join(), 'סדר הפקודות תואם את רצף ההדפסה של B1');

  if (OUT_DIR) {
    mkdirSync(OUT_DIR, { recursive: true });
    result.pages.forEach((image, index) => {
      // PBM: פורמט תמונה טקסטואלי פשוט, 1 = שחור
      const pbm = `P1\n${image.width} ${image.height}\n${image.rows.join('\n')}\n`;
      writeFileSync(join(OUT_DIR, `label-${labelId}-${index + 1}.pbm`), pbm);
    });
  }
}

console.log('טיפול בשגיאות:');
const failure = await page.evaluate(async (boxes) => {
  const niimbot = await import('./js/niimbot.js');
  const { createBox } = await import('./js/boxes.js');
  const printer = window.__printer;
  printer.failWith = 2; // נגמרו המדבקות
  printer.ended = 0;
  try {
    await niimbot.printBoxes(createBox({ ...boxes[0], device: 'בדיקה' }), { labelId: '50x30' });
    return { threw: false };
  } catch (error) {
    return { threw: true, message: error.message, ended: printer.ended };
  } finally {
    printer.failWith = null;
  }
}, BOXES);
report(failure.threw && failure.message === 'נגמרו המדבקות', `שגיאת מדפסת מוצגת בעברית: "${failure.message}"`);
report(failure.ended >= 1, 'משימת ההדפסה נסגרת גם אחרי כשל');

await browser.close();
console.log(errors.length ? `\nשגיאות (${errors.length}):\n` + errors.join('\n') : '\nכל הבדיקות עברו ✓');
process.exit(errors.length ? 1 : 0);
