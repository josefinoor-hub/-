/**
 * niimbot.js — הדפסה למדפסת המדבקות NIIMBOT B1 מעל Web Bluetooth.
 *
 * ה-B1 אינה מדפסת ESC/POS: היא מדברת פרוטוקול ייעודי של NIIMBOT. כל הודעה
 * עטופה כך:
 *
 *     55 55 | פקודה | אורך | נתונים… | סכום ביקורת | AA AA
 *
 * וסכום הביקורת הוא XOR של הפקודה, האורך וכל בתי הנתונים. המדבקה נשלחת
 * כמפת נקודות, שורה אחר שורה, ברוחב ראש ההדפסה (384 נקודות = 48 מ"מ).
 *
 * רצף ההדפסה ל-B1:
 *   כהות ← סוג מדבקה ← התחלת הדפסה ← [לכל מדבקה: התחלת עמוד ← מידות ←
 *   שורות התמונה ← סוף עמוד] ← המתנה לסיום ← סוף הדפסה
 *
 * דרישות: Chrome לאנדרואיד (או למחשב) מעל HTTPS, והפעלה מתוך לחיצת משתמש.
 */

import { NIIMBOT, NIIMBOT_LABELS } from './config.js';
import { canvasToRows, renderLabelCanvas } from './labelCanvas.js';
import { sleep } from './util.js';

// ---------------------------------------------------------------------------
// קודי הפרוטוקול
// ---------------------------------------------------------------------------

export const COMMAND = {
  PRINT_START: 0x01,
  PAGE_START: 0x03,
  SET_PAGE_SIZE: 0x13,
  SET_DENSITY: 0x21,
  SET_LABEL_TYPE: 0x23,
  PRINT_BITMAP_ROW: 0x85,
  PRINT_EMPTY_ROW: 0x84,
  PRINT_STATUS: 0xa3,
  CONNECT: 0xc1,
  PAGE_END: 0xe3,
  PRINT_END: 0xf3,
};

export const RESPONSE = {
  NOT_SUPPORTED: 0x00,
  PRINT_START: 0x02,
  PAGE_START: 0x04,
  SET_PAGE_SIZE: 0x14,
  SET_DENSITY: 0x31,
  SET_LABEL_TYPE: 0x33,
  PRINT_STATUS: 0xb3,
  CONNECT: 0xc2,
  PRINT_ERROR: 0xdb,
  PAGE_END: 0xe4,
  PRINT_END: 0xf4,
};

/** סוג המדבקה: 1 = מדבקות עם רווח ביניהן (הגלילים הרגילים של B1). */
const LABEL_TYPE_WITH_GAPS = 1;

/** הודעות שגיאה שהמדפסת מדווחת, בעברית. */
const PRINTER_ERRORS = {
  1: 'מכסה המדפסת פתוח',
  2: 'נגמרו המדבקות',
  3: 'הסוללה חלשה — טענו את המדפסת',
  4: 'תקלת סוללה',
  5: 'ההדפסה בוטלה מהמדפסת',
  6: 'המדפסת דיווחה על נתונים שגויים',
  7: 'המדפסת התחממה — המתינו מעט',
  8: 'תקלה בהזנת המדבקות',
  9: 'המדפסת עסוקה',
  16: 'גליל המדבקות אינו מזוהה — ודאו שהגליל מתאים ל-B1 ושהוא מוכנס כהלכה',
  17: 'המדפסת לא הצליחה לכייל את המדבקה',
};

/** שמות המכשירים של NIIMBOT מתחילים באות גדולה (B1-…, D11-…). */
const NAME_PREFIXES = ['B', 'D', 'A', 'N', 'H', 'K', 'P', 'T', 'Z', 'M', 'J', 'S', 'E', 'C'];

const ROW_PACING_MS = 6;
const RESPONSE_TIMEOUT_MS = 4000;

// ---------------------------------------------------------------------------
// בניית הודעות ופענוחן — פונקציות טהורות, נבדקות בלי מדפסת
// ---------------------------------------------------------------------------

/** בניית הודעה אחת בפורמט של NIIMBOT. */
export function buildPacket(command, data = []) {
  let checksum = command ^ data.length;
  for (const byte of data) checksum ^= byte;

  const body = [0x55, 0x55, command, data.length, ...data, checksum & 0xff, 0xaa, 0xaa];
  // פקודת ההתחברות נשלחת עם בית מקדים — כך מצפה לה המדפסת
  return Uint8Array.from(command === COMMAND.CONNECT ? [0x03, ...body] : body);
}

const u16 = (value) => [(value >> 8) & 0xff, value & 0xff];

/**
 * מפענח זרם בתים להודעות. הודעה יכולה להגיע מפוצלת בין כמה התראות, או
 * כמה הודעות בהתראה אחת — לכן נשמר מאגר מצטבר.
 */
export function createPacketParser(onPacket) {
  let buffer = [];

  return function feed(bytes) {
    buffer.push(...bytes);

    for (;;) {
      // איתור תחילת הודעה
      let start = -1;
      for (let i = 0; i + 1 < buffer.length; i++) {
        if (buffer[i] === 0x55 && buffer[i + 1] === 0x55) {
          start = i;
          break;
        }
      }
      if (start < 0) {
        buffer = buffer.slice(-1); // ייתכן שנשאר 55 בודד בקצה
        return;
      }
      if (start > 0) buffer = buffer.slice(start);
      if (buffer.length < 4) return;

      const command = buffer[2];
      const length = buffer[3];
      const total = 4 + length + 3;
      if (buffer.length < total) return;

      const data = buffer.slice(4, 4 + length);
      const checksum = buffer[4 + length];
      const tailOk = buffer[5 + length] === 0xaa && buffer[6 + length] === 0xaa;

      let expected = command ^ length;
      for (const byte of data) expected ^= byte;

      if (tailOk && checksum === (expected & 0xff)) {
        buffer = buffer.slice(total);
        onPacket({ command, data });
      } else {
        // הודעה פגומה — מדלגים על הכותרת ומחפשים את הבאה
        buffer = buffer.slice(2);
      }
    }
  };
}

/** ספירת הנקודות השחורות בכל שליש של ראש ההדפסה — חלק מכותרת השורה. */
function countBlackDots(row) {
  const chunk = Math.floor(NIIMBOT.PRINTHEAD_DOTS / 8 / 3);
  const counts = [0, 0, 0];
  for (let index = 0; index < row.length; index++) {
    let byte = row[index];
    let bits = 0;
    while (byte) {
      bits += byte & 1;
      byte >>= 1;
    }
    counts[Math.min(2, Math.floor(index / chunk))] += bits;
  }
  return counts.map((count) => Math.min(255, count));
}

const rowsEqual = (a, b) => a.length === b.length && a.every((byte, index) => byte === b[index]);

/**
 * המרת שורות התמונה להודעות הדפסה. שורות זהות ברצף נשלחות פעם אחת עם
 * מונה חזרות, ושורות ריקות נשלחות כהודעה קצרה — כך ההדפסה מהירה יותר.
 * @param {Uint8Array[]} rows
 * @returns {Uint8Array[]}
 */
export function encodeImageRows(rows) {
  const packets = [];
  let index = 0;

  while (index < rows.length) {
    const row = rows[index];
    let repeats = 1;
    while (index + repeats < rows.length && repeats < 255 && rowsEqual(row, rows[index + repeats])) repeats++;

    const isEmpty = row.every((byte) => byte === 0);
    packets.push(
      isEmpty
        ? buildPacket(COMMAND.PRINT_EMPTY_ROW, [...u16(index), repeats])
        : buildPacket(COMMAND.PRINT_BITMAP_ROW, [...u16(index), ...countBlackDots(row), repeats, ...row])
    );
    index += repeats;
  }
  return packets;
}

/** גודל המדבקה בנקודות, מוגבל לרוחב ראש ההדפסה. */
export function labelDots(labelId) {
  const label = NIIMBOT_LABELS[labelId] || NIIMBOT_LABELS[NIIMBOT.DEFAULT_LABEL];
  return {
    widthDots: Math.min(label.widthMm * NIIMBOT.DOTS_PER_MM, NIIMBOT.PRINTHEAD_DOTS),
    heightDots: label.heightMm * NIIMBOT.DOTS_PER_MM,
  };
}

/** תצוגה מקדימה: אותו קנבס בדיוק שיישלח למדפסת. */
export function renderPreview(box, labelId) {
  return renderLabelCanvas(box, labelDots(labelId));
}

// ---------------------------------------------------------------------------
// חיבור Bluetooth
// ---------------------------------------------------------------------------

let connection = null;

export function isSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.bluetooth);
}

export function isConnected() {
  return Boolean(connection?.device?.gatt?.connected);
}

export function connectedName() {
  return connection?.device?.name || '';
}

/**
 * חיבור למדפסת. חייב להיקרא מתוך לחיצת משתמש.
 * הדפדפן יציג חלון בחירה — בוחרים את המכשיר ששמו מתחיל ב-B1.
 */
export async function connect() {
  if (!isSupported()) {
    throw new Error('הדפדפן הזה אינו תומך ב-Bluetooth. פתחו את האפליקציה ב-Chrome באנדרואיד.');
  }
  if (isConnected()) return connection;

  const device = await navigator.bluetooth.requestDevice({
    filters: NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
    optionalServices: [NIIMBOT.SERVICE_UUID],
  });

  const server = await device.gatt.connect();
  const characteristic = await findCharacteristic(server);
  if (!characteristic) {
    device.gatt.disconnect();
    throw new Error('המכשיר שנבחר אינו מדפסת NIIMBOT. בחרו את המכשיר ששמו מתחיל ב-B1.');
  }

  const state = { device, characteristic, pending: null, lastError: null };
  const feed = createPacketParser((packet) => handlePacket(state, packet));
  characteristic.addEventListener('characteristicvaluechanged', (event) => {
    const view = event.target.value;
    feed(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  });
  await characteristic.startNotifications();

  device.addEventListener('gattserverdisconnected', () => {
    state.pending?.reject(new Error('החיבור למדפסת נותק'));
    if (connection === state) connection = null;
  });

  connection = state;

  // לחיצת יד. מדפסת שאינה עונה עליה עדיין עשויה להדפיס, ולכן לא נכשלים כאן
  await request(COMMAND.CONNECT, [1], [RESPONSE.CONNECT], 2000).catch(() => {});
  return connection;
}

export function disconnect() {
  if (connection?.device?.gatt?.connected) connection.device.gatt.disconnect();
  connection = null;
}

/** ערוץ התקשורת של NIIMBOT: מאפיין אחד שתומך גם בהתראות וגם בכתיבה. */
async function findCharacteristic(server) {
  let services = [];
  try {
    services = [await server.getPrimaryService(NIIMBOT.SERVICE_UUID)];
  } catch {
    services = await server.getPrimaryServices().catch(() => []);
  }
  for (const service of services) {
    const characteristics = await service.getCharacteristics().catch(() => []);
    const match = characteristics.find(
      (item) => item.properties.notify && (item.properties.writeWithoutResponse || item.properties.write)
    );
    if (match) return match;
  }
  return null;
}

function handlePacket(state, packet) {
  if (packet.command === RESPONSE.PRINT_ERROR) {
    const code = packet.data[0];
    const error = new Error(PRINTER_ERRORS[code] || `המדפסת דיווחה על שגיאה (קוד ${code})`);
    state.lastError = error;
    state.pending?.reject(error);
    return;
  }
  const pending = state.pending;
  if (!pending) return;
  if (packet.command === RESPONSE.NOT_SUPPORTED) {
    pending.reject(new Error('המדפסת אינה תומכת בפקודה הזו'));
    return;
  }
  if (pending.accepts.includes(packet.command)) pending.resolve(packet);
}

async function write(bytes) {
  const { characteristic } = connection;
  if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
    await characteristic.writeValueWithoutResponse(bytes);
  } else {
    await characteristic.writeValue(bytes);
  }
}

/** שליחת פקודה והמתנה לתשובת המדפסת. */
function request(command, data, accepts, timeoutMs = RESPONSE_TIMEOUT_MS) {
  const state = connection;
  if (!state) return Promise.reject(new Error('המדפסת אינה מחוברת'));

  return new Promise((resolve, reject) => {
    const finish = (settle) => (value) => {
      clearTimeout(timer);
      if (state.pending === pending) state.pending = null;
      settle(value);
    };
    const pending = { accepts, resolve: null, reject: null };
    pending.resolve = finish(resolve);
    pending.reject = finish(reject);

    const timer = setTimeout(
      () => pending.reject(new Error('המדפסת לא ענתה. ודאו שהיא דלוקה וקרובה לטלפון.')),
      timeoutMs
    );
    state.pending = pending;
    write(buildPacket(command, data)).catch(pending.reject);
  });
}

// ---------------------------------------------------------------------------
// הדפסה
// ---------------------------------------------------------------------------

/** המתנה עד שהמדפסת מדווחת שהדפיסה את מספר המדבקות המבוקש. */
async function waitForPages(pages, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (connection?.lastError) throw connection.lastError;
    try {
      const status = await request(COMMAND.PRINT_STATUS, [1], [RESPONSE.PRINT_STATUS], 2000);
      const printed = (status.data[0] << 8) | status.data[1];
      if (printed >= pages) return true;
    } catch (error) {
      if (connection?.lastError) throw connection.lastError;
      if (!isConnected()) throw error;
    }
    await sleep(300);
  }
  return false;
}

/**
 * הדפסת ארגז אחד או יותר.
 * @param {object|object[]} boxes
 * @param {{labelId?: string, density?: number, onProgress?: (done: number, total: number) => void}} [options]
 * @returns {Promise<number>} מספר המדבקות שנשלחו
 */
export async function printBoxes(boxes, { labelId, density = NIIMBOT.DEFAULT_DENSITY, onProgress } = {}) {
  const list = [].concat(boxes).filter(Boolean);
  if (!list.length) return 0;

  await connect();
  connection.lastError = null;
  const size = labelDots(labelId);
  const safeDensity = Math.min(5, Math.max(1, Number(density) || NIIMBOT.DEFAULT_DENSITY));

  try {
    // הגדרות שאינן קריטיות: מדפסת שמתעלמת מהן עדיין תדפיס בברירות המחדל שלה
    await request(COMMAND.SET_DENSITY, [safeDensity], [RESPONSE.SET_DENSITY]).catch(rethrowPrinterError);
    await request(COMMAND.SET_LABEL_TYPE, [LABEL_TYPE_WITH_GAPS], [RESPONSE.SET_LABEL_TYPE]).catch(rethrowPrinterError);

    await request(COMMAND.PRINT_START, [...u16(list.length), 0, 0, 0, 0, 0], [RESPONSE.PRINT_START]);

    for (let index = 0; index < list.length; index++) {
      const image = canvasToRows(renderLabelCanvas(list[index], size));

      await request(COMMAND.PAGE_START, [1], [RESPONSE.PAGE_START]);
      await request(
        COMMAND.SET_PAGE_SIZE,
        [...u16(image.height), ...u16(image.width), ...u16(1)],
        [RESPONSE.SET_PAGE_SIZE]
      );

      for (const packet of encodeImageRows(image.rows)) {
        await write(packet);
        await sleep(ROW_PACING_MS);
      }

      await request(COMMAND.PAGE_END, [1], [RESPONSE.PAGE_END]);
      // נותנים למדפסת לסיים את המדבקה לפני שליחת הבאה
      await waitForPages(index + 1, 12000);
      onProgress?.(index + 1, list.length);
    }

    await waitForPages(list.length, 8000);
  } finally {
    // סוגרים את משימת ההדפסה גם אחרי כשל, אחרת המדפסת נשארת "באמצע הדפסה"
    await endPrint().catch(() => {});
  }

  if (connection?.lastError) throw connection.lastError;
  return list.length;
}

/** המדפסת עונה 0 כל עוד היא עדיין מדפיסה — מנסים שוב עד שהיא מאשרת. */
async function endPrint() {
  if (!isConnected()) return;
  for (let attempt = 0; attempt < 20; attempt++) {
    const reply = await request(COMMAND.PRINT_END, [1], [RESPONSE.PRINT_END], 2000);
    if (!reply.data.length || reply.data[0] !== 0) return;
    await sleep(150);
  }
}

/** שגיאה שהמדפסת עצמה דיווחה חייבת לעצור את ההדפסה; היעדר תשובה — לא. */
function rethrowPrinterError(error) {
  if (connection?.lastError) throw connection.lastError;
  console.debug('המדפסת לא אישרה הגדרה, ממשיכים', error.message);
}
