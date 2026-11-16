/**
 * thermal.js — הדפסה למדפסת קבלות תרמית בפרוטוקול ESC/POS מעל Web Bluetooth.
 *
 * זהו המסלול למדפסות קבלות גנריות (58/80 מ"מ). מדפסת המדבקות NIIMBOT B1
 * אינה מדברת ESC/POS — המסלול שלה נמצא ב-niimbot.js.
 *
 * המדבקה נשלחת כתמונה ולא כטקסט: מדפסות תרמיות זולות רבות אינן מכילות גופן
 * עברי, וטקסט עברי היה יוצא ג'יבריש או הפוך.
 */

import { THERMAL_BLE_SERVICES, THERMAL_WIDTHS } from './config.js';
import { canvasToRows, renderLabelCanvas } from './labelCanvas.js';
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
 * מציג את כל המכשירים הסמוכים, כי מדפסות קבלות מפרסמות שירותים שונים.
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

/** גודל המדבקה על נייר קבלות: רוחב הנייר, ביחס של מדבקה רחבה. */
function receiptLabelSize(widthMm) {
  const widthDots = THERMAL_WIDTHS[widthMm] || THERMAL_WIDTHS[58];
  return { widthDots, heightDots: Math.round(widthDots * 0.6) };
}

/** תצוגה מקדימה: אותו קנבס בדיוק שיישלח למדפסת. */
export function renderPreview(box, widthMm) {
  return renderLabelCanvas(box, receiptLabelSize(widthMm));
}

/** המרת קנבס לפקודת הדפסת ראסטר GS v 0. */
export function canvasToEscPos(canvas) {
  const { width, height, rows } = canvasToRows(canvas);
  const bytesPerRow = width / 8;

  const header = [
    0x1b, 0x40, // ESC @ — אתחול המדפסת
    0x1d, 0x76, 0x30, 0x00, // GS v 0 — הדפסת ראסטר במצב רגיל
    bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ];
  const footer = [0x1b, 0x64, 0x03]; // ESC d 3 — הזנת נייר

  const payload = new Uint8Array(header.length + bytesPerRow * height + footer.length);
  payload.set(header, 0);
  rows.forEach((row, index) => payload.set(row, header.length + index * bytesPerRow));
  payload.set(footer, header.length + bytesPerRow * height);
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
 * הדפסת ארגז אחד או יותר במדפסת הקבלות.
 * @param {object|object[]} boxes
 * @param {{widthMm?: number, onProgress?: (done: number, total: number) => void}} [options]
 */
export async function printBoxes(boxes, { widthMm = 58, onProgress } = {}) {
  const list = [].concat(boxes).filter(Boolean);
  if (!list.length) return 0;

  const { characteristic } = await connect();
  const size = receiptLabelSize(widthMm);

  for (let index = 0; index < list.length; index++) {
    await writeBytes(characteristic, canvasToEscPos(renderLabelCanvas(list[index], size)));
    await sleep(120);
    onProgress?.(index + 1, list.length);
  }
  return list.length;
}
