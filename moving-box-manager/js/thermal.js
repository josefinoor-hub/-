/**
 * thermal.js — הדפסה למדפסת תרמית ניידת בפרוטוקול ESC/POS מעל Web Bluetooth.
 *
 * שיקול תכנון: המדבקה כולה מצוירת כתמונה (raster) ולא נשלחת כטקסט. מדפסות
 * תרמיות זולות רבות אינן מכילות גופן עברי, וטקסט עברי היה יוצא ג'יבריש או
 * הפוך. ציור לקנבס ושליחה כביטמאפ מבטיח שמה שרואים בתצוגה המקדימה הוא בדיוק
 * מה שיודפס — עברית, אייקונים וקוד ה-QR כאחד.
 *
 * דרישות: Chrome לאנדרואיד מעל HTTPS, ולחיצת משתמש שמפעילה את בחירת המדפסת.
 */

import { THERMAL_BLE_SERVICES, THERMAL_WIDTHS } from './config.js';
import { buildQrPayload, itemsSummary } from './boxes.js';
import { encodeQr } from './qr.js';
import { sleep } from './util.js';

const CHUNK_SIZE = 180;
const CHUNK_DELAY_MS = 20;

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
 * חיבור למדפסת. חייב להיקרא מתוך אירוע לחיצה — כך דורש הדפדפן.
 * מציג את כל המכשירים הסמוכים, כי מדפסות תרמיות מפרסמות שירותים שונים.
 */
export async function connect() {
  if (!isSupported()) {
    throw new Error('הדפדפן הזה אינו תומך ב-Bluetooth. השתמשו ב-Chrome לאנדרואיד, או הדפיסו דרך שירות ההדפסה.');
  }
  if (isConnected()) return connection;

  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: THERMAL_BLE_SERVICES,
  });

  const server = await device.gatt.connect();
  const characteristic = await findWritableCharacteristic(server);
  if (!characteristic) {
    device.gatt.disconnect();
    throw new Error('לא נמצא ערוץ כתיבה במדפסת. ודאו שנבחרה מדפסת ולא מכשיר אחר.');
  }

  device.addEventListener('gattserverdisconnected', () => {
    connection = null;
  });

  connection = { device, characteristic };
  return connection;
}

export function disconnect() {
  if (connection?.device?.gatt?.connected) connection.device.gatt.disconnect();
  connection = null;
}

async function findWritableCharacteristic(server) {
  const services = await server.getPrimaryServices();
  for (const service of services) {
    let characteristics = [];
    try {
      characteristics = await service.getCharacteristics();
    } catch {
      continue;
    }
    const writable = characteristics.find(
      (characteristic) =>
        characteristic.properties.write || characteristic.properties.writeWithoutResponse
    );
    if (writable) return writable;
  }
  return null;
}

// ---------------------------------------------------------------------------
// ציור המדבקה
// ---------------------------------------------------------------------------

/**
 * מצייר את המדבקה לקנבס ברוחב הנקודות של המדפסת.
 * @returns {HTMLCanvasElement}
 */
export function renderLabelCanvas(box, { widthDots = 384 } = {}) {
  const qr = encodeQr(buildQrPayload(box, { mode: 'text' }), { ecc: 'M' });
  const scale = Math.max(2, Math.floor((widthDots * 0.42) / qr.size));
  const qrPixels = qr.size * scale;
  const padding = 12;
  const height = Math.max(qrPixels + padding * 2, 190);

  const canvas = document.createElement('canvas');
  canvas.width = widthDots;
  canvas.height = height;
  const context = canvas.getContext('2d');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000';
  context.direction = 'rtl';
  context.textAlign = 'right';
  context.textBaseline = 'top';

  // קוד ה-QR בצד שמאל
  const qrX = padding;
  const qrY = Math.round((height - qrPixels) / 2);
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) context.fillRect(qrX + x * scale, qrY + y * scale, scale, scale);
    }
  }

  // הטקסט בצד ימין
  const textRight = widthDots - padding;
  const textWidth = widthDots - qrPixels - padding * 3;
  let cursorY = padding;

  context.font = `bold ${Math.round(widthDots * 0.085)}px system-ui, Arial, sans-serif`;
  cursorY = drawWrapped(context, box.room || '', textRight, cursorY, textWidth, Math.round(widthDots * 0.1));

  context.font = `bold ${Math.round(widthDots * 0.13)}px system-ui, Arial, sans-serif`;
  context.fillText(box.boxNumber || 'ללא מספר', textRight, cursorY);
  cursorY += Math.round(widthDots * 0.16);

  context.font = `${Math.round(widthDots * 0.055)}px system-ui, Arial, sans-serif`;
  cursorY = drawWrapped(
    context,
    itemsSummary(box, 90),
    textRight,
    cursorY,
    textWidth,
    Math.round(widthDots * 0.07),
    3
  );

  const marks = [box.fragile ? 'שביר' : '', box.priority === 'high' ? 'פריקה ראשונה' : '']
    .filter(Boolean)
    .join(' • ');
  if (marks) {
    context.font = `bold ${Math.round(widthDots * 0.055)}px system-ui, Arial, sans-serif`;
    context.fillText(marks, textRight, cursorY);
  }

  return canvas;
}

/** ציור טקסט עם גלישת שורות. מחזיר את מיקום ה-Y אחרי הטקסט. */
function drawWrapped(context, text, right, top, maxWidth, lineHeight, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = candidate;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);

  let y = top;
  for (const entry of lines) {
    context.fillText(entry, right, y);
    y += lineHeight;
  }
  return y;
}

// ---------------------------------------------------------------------------
// המרה לפקודות ESC/POS
// ---------------------------------------------------------------------------

/**
 * המרת קנבס לפקודת הדפסת ראסטר GS v 0.
 * כל פיקסל כהה מסף מסוים הופך לנקודה שחורה.
 */
export function canvasToEscPos(canvas, { threshold = 160 } = {}) {
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  const image = context.getImageData(0, 0, width, height).data;
  const bytesPerRow = Math.ceil(width / 8);
  const raster = new Uint8Array(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const alpha = image[offset + 3];
      // שקלול לבהירות תפיסתית; פיקסל שקוף נחשב לבן
      const luminance =
        alpha === 0 ? 255 : 0.299 * image[offset] + 0.587 * image[offset + 1] + 0.114 * image[offset + 2];
      if (luminance < threshold) {
        raster[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  const header = new Uint8Array([
    0x1b, 0x40, // ESC @ — אתחול המדפסת
    0x1d, 0x76, 0x30, 0x00, // GS v 0 — הדפסת ראסטר במצב רגיל
    bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ]);
  const footer = new Uint8Array([0x1b, 0x64, 0x03]); // ESC d 3 — הזנת נייר

  const payload = new Uint8Array(header.length + raster.length + footer.length);
  payload.set(header, 0);
  payload.set(raster, header.length);
  payload.set(footer, header.length + raster.length);
  return payload;
}

/** שליחת הבתים למדפסת בחלקים קטנים — BLE מגביל את גודל המנה. */
async function writeBytes(characteristic, bytes) {
  const withoutResponse = characteristic.properties.writeWithoutResponse;
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.slice(offset, offset + CHUNK_SIZE);
    if (withoutResponse && characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      await characteristic.writeValue(chunk);
    }
    await sleep(CHUNK_DELAY_MS);
  }
}

/**
 * הדפסת ארגז אחד או יותר במדפסת התרמית.
 * @param {object|object[]} boxes
 * @param {{widthMm?: number}} [options]
 */
export async function printBoxes(boxes, { widthMm = 58 } = {}) {
  const list = [].concat(boxes).filter(Boolean);
  if (!list.length) return 0;

  const { characteristic } = await connect();
  const widthDots = THERMAL_WIDTHS[widthMm] || THERMAL_WIDTHS[58];

  for (const box of list) {
    const canvas = renderLabelCanvas(box, { widthDots });
    await writeBytes(characteristic, canvasToEscPos(canvas));
    await sleep(120);
  }
  return list.length;
}
