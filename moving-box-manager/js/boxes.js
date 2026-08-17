/**
 * boxes.js — לוגיקת התחום: יצירת ארגז, מחרוזת ה-QR, פענוח סריקה וחיפוש.
 * המודול הזה טהור מצד תופעות לוואי — קל לבדוק אותו ולהשתמש בו מכל מקום.
 */

import {
  BOX_PREFIX,
  BOX_NUMBER_PADDING,
  PRIORITY,
  QR_PREFIX,
  QR_SUMMARY_MAX_CHARS,
  ROOM_BY_NAME,
  UNKNOWN_ROOM,
} from './config.js';
import { normalizeText, splitItems, truncate, uuid } from './util.js';

/** BOX-007 מתוך 7. */
export function formatBoxNumber(number) {
  if (!Number.isFinite(number)) return '';
  return `${BOX_PREFIX}-${String(number).padStart(BOX_NUMBER_PADDING, '0')}`;
}

/** פרטי התצוגה של חדר (צבע ואייקון), עם נפילה לברירת מחדל. */
export function roomInfo(name) {
  return ROOM_BY_NAME.get(name) || { ...UNKNOWN_ROOM, name: name || UNKNOWN_ROOM.name };
}

/**
 * יצירת רשומת ארגז חדשה.
 * @param {{room: string, items: string|string[], fragile?: boolean, priority?: string,
 *          notes?: string, number?: number|null, device?: string}} input
 */
export function createBox(input) {
  const now = new Date().toISOString();
  const number = Number.isFinite(input.number) ? input.number : null;
  return {
    id: uuid(),
    number,
    boxNumber: number === null ? '' : formatBoxNumber(number),
    room: input.room,
    items: Array.isArray(input.items) ? input.items.filter(Boolean) : splitItems(input.items),
    fragile: Boolean(input.fragile),
    priority: input.priority === PRIORITY.HIGH ? PRIORITY.HIGH : PRIORITY.NORMAL,
    notes: (input.notes || '').trim(),
    createdAt: now,
    updatedAt: now,
    deleted: false,
    updatedBy: input.device || '',
  };
}

/** החלת שינויים על ארגז קיים, כולל חותמת עדכון. */
export function updateBox(box, patch, device = '') {
  const next = { ...box, ...patch };
  if (patch.items !== undefined) {
    next.items = Array.isArray(patch.items) ? patch.items.filter(Boolean) : splitItems(patch.items);
  }
  if (Number.isFinite(patch.number)) next.boxNumber = formatBoxNumber(patch.number);
  next.updatedAt = new Date().toISOString();
  next.updatedBy = device || box.updatedBy || '';
  return next;
}

/** מחיקה רכה — הרשומה נשמרת כדי שהמחיקה תסונכרן לשאר המכשירים. */
export function markDeleted(box, device = '') {
  return { ...box, deleted: true, updatedAt: new Date().toISOString(), updatedBy: device };
}

/** תמצית התכולה — לשורת המדבקה ולתוך מחרוזת ה-QR. */
export function itemsSummary(box, maxChars = QR_SUMMARY_MAX_CHARS) {
  return truncate((box.items || []).join(', '), maxChars);
}

/**
 * מחרוזת ה-QR של הארגז.
 *
 * במצב 'text' (ברירת המחדל) המחרוזת מקודדת את מזהה הארגז, החדר ותמצית
 * התכולה — היא נקראת גם באפליקציה וגם בכל סורק גנרי, ואינה תלויה ברשת.
 * במצב 'url' מקודד קישור שפותח את הארגז ישירות באפליקציה.
 */
export function buildQrPayload(box, { mode = 'text', baseUrl = '' } = {}) {
  const number = box.boxNumber || formatBoxNumber(box.number) || box.id.slice(0, 8);
  if (mode === 'url') {
    const base = baseUrl || (typeof location !== 'undefined' ? location.origin + location.pathname : '');
    return `${base}#/box/${encodeURIComponent(number)}`;
  }
  return [QR_PREFIX, number, box.room || '', itemsSummary(box)].join('|');
}

/**
 * פענוח טקסט שהתקבל מסריקה. מזהה את הפורמט של האפליקציה, קישורים
 * שנוצרו על ידה, וגם הקלדה ידנית של מספר ארגז.
 * @returns {{boxNumber: string, room?: string, summary?: string}|null}
 */
export function parseScan(text) {
  const value = String(text || '').trim();
  if (!value) return null;

  if (value.startsWith(`${QR_PREFIX}|`)) {
    const [, boxNumber, room, summary] = value.split('|');
    return { boxNumber: (boxNumber || '').trim(), room, summary };
  }

  const urlMatch = value.match(/#\/box\/([^&?\s]+)/);
  if (urlMatch) return { boxNumber: decodeURIComponent(urlMatch[1]) };

  const numberMatch = value.match(new RegExp(`${BOX_PREFIX}[-\\s]?(\\d+)`, 'i'));
  if (numberMatch) return { boxNumber: formatBoxNumber(Number(numberMatch[1])) };

  if (/^\d{1,6}$/.test(value)) return { boxNumber: formatBoxNumber(Number(value)) };

  return null;
}

/**
 * חיפוש חופשי בארגזים לפי פריט, חדר או מספר ארגז.
 * כל מילה בשאילתה חייבת להימצא (AND), והתוצאות מדורגות לפי סוג ההתאמה.
 */
export function searchBoxes(boxes, query) {
  const normalized = normalizeText(query);
  if (!normalized) return boxes;
  const terms = normalized.split(' ').filter(Boolean);

  const scored = [];
  for (const box of boxes) {
    const haystacks = {
      number: normalizeText(box.boxNumber),
      room: normalizeText(box.room),
      items: normalizeText((box.items || []).join(' ')),
      notes: normalizeText(box.notes),
    };
    const digitsOnly = String(box.number ?? '');

    let score = 0;
    const matchesAll = terms.every((term) => {
      if (digitsOnly && digitsOnly === term.replace(/\D/g, '')) {
        score += 100;
        return true;
      }
      if (haystacks.number.includes(term)) {
        score += 60;
        return true;
      }
      if (haystacks.items.startsWith(term)) {
        score += 40;
        return true;
      }
      if (haystacks.items.includes(term)) {
        score += 30;
        return true;
      }
      if (haystacks.room.includes(term)) {
        score += 20;
        return true;
      }
      if (haystacks.notes.includes(term)) {
        score += 10;
        return true;
      }
      return false;
    });

    if (matchesAll) scored.push({ box, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || (b.box.number ?? 0) - (a.box.number ?? 0))
    .map((entry) => entry.box);
}

/** קיבוץ ארגזים לפי חדר, בסדר החדרים המוגדר. */
export function groupByRoom(boxes) {
  const groups = new Map();
  for (const box of boxes) {
    const key = box.room || UNKNOWN_ROOM.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(box);
  }
  return groups;
}

/** סטטיסטיקה קצרה למסך הראשי. */
export function statistics(boxes) {
  return {
    total: boxes.length,
    fragile: boxes.filter((box) => box.fragile).length,
    highPriority: boxes.filter((box) => box.priority === PRIORITY.HIGH).length,
    rooms: new Set(boxes.map((box) => box.room)).size,
    items: boxes.reduce((sum, box) => sum + (box.items?.length || 0), 0),
    unnumbered: boxes.filter((box) => !box.boxNumber).length,
  };
}
