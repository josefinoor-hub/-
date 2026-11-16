/**
 * printer.js — נקודת כניסה אחת למדפסת המדבקות שמחוברת ב-Bluetooth.
 *
 * הממשק אינו צריך לדעת איזו מדפסת מחוברת: הוא מבקש "הדפס את הארגז הזה",
 * והמודול הזה מנתב למימוש המתאים לפי ההגדרות — NIIMBOT B1 או מדפסת קבלות.
 */

import { NIIMBOT_LABELS, PRINTER_TYPES } from './config.js';
import * as niimbot from './niimbot.js';
import * as thermal from './thermal.js';
import { getSettings } from './settings.js';

function isNiimbot() {
  return getSettings().printerType !== 'escpos';
}

function driver() {
  return isNiimbot() ? niimbot : thermal;
}

export function isSupported() {
  return driver().isSupported();
}

export function isConnected() {
  return driver().isConnected();
}

export function connectedName() {
  return driver().connectedName();
}

/** שם המדפסת שנבחרה בהגדרות, להצגה בכפתורים ובהודעות. */
export function typeLabel() {
  return PRINTER_TYPES[isNiimbot() ? 'niimbot' : 'escpos'];
}

/** תיאור קצר של המדבקה שתודפס, למשל "50×30 מ"מ". */
export function mediaLabel() {
  const settings = getSettings();
  if (!isNiimbot()) return `נייר ${settings.thermalWidth} מ"מ`;
  return (NIIMBOT_LABELS[settings.niimbotLabel] || NIIMBOT_LABELS['50x30']).label;
}

/** חיבור למדפסת — חייב להיקרא מתוך לחיצת משתמש. */
export function connect() {
  return driver().connect();
}

export function disconnect() {
  niimbot.disconnect();
  thermal.disconnect();
}

/** קנבס התצוגה המקדימה — אותה תמונה בדיוק שתישלח למדפסת. */
export function renderPreview(box) {
  const settings = getSettings();
  return isNiimbot()
    ? niimbot.renderPreview(box, settings.niimbotLabel)
    : thermal.renderPreview(box, settings.thermalWidth);
}

/**
 * הדפסת ארגז אחד או יותר במדפסת המחוברת.
 * @param {object|object[]} boxes
 * @param {{onProgress?: (done: number, total: number) => void}} [options]
 */
export function printBoxes(boxes, { onProgress } = {}) {
  const settings = getSettings();
  return isNiimbot()
    ? niimbot.printBoxes(boxes, {
        labelId: settings.niimbotLabel,
        density: settings.niimbotDensity,
        onProgress,
      })
    : thermal.printBoxes(boxes, { widthMm: settings.thermalWidth, onProgress });
}
