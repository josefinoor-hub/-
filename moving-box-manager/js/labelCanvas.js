/**
 * labelCanvas.js — ציור המדבקה כתמונת שחור-לבן בגודל נקודות קבוע.
 *
 * מדפסות מדבקות תרמיות מדפיסות מפת נקודות ולא טקסט: כל מדבקה נשלחת כתמונה
 * ברוחב ובגובה מדויקים בנקודות. המודול הזה מצייר את המדבקה לקנבס בגודל
 * המבוקש — כך עברית, מספר הארגז וקוד ה-QR יוצאים בדיוק כפי שהם נראים
 * בתצוגה המקדימה, בלי תלות בגופנים שבמדפסת.
 */

import { buildQrPayload } from './boxes.js';
import { encodeQr } from './qr.js';

const FONT_STACK = 'system-ui, "Noto Sans Hebrew", "Segoe UI", Arial, sans-serif';

/** גודל מודול מינימלי (בנקודות) שסורק טלפון קורא בנוחות ב-203dpi. */
const COMFORTABLE_MODULE_DOTS = 4;

/**
 * בחירת קוד ה-QR הגדול ביותר שנכנס בשטח הנתון. ככל שהמחרוזת קצרה יותר,
 * המודולים גדולים יותר והסריקה אמינה יותר — לכן התמצית מתקצרת עד שהקוד
 * נוח לסריקה, ומזהה הארגז והחדר נשארים תמיד.
 */
function fitQr(box, maxDots) {
  let best = null;
  for (const summaryMax of [40, 20, 0]) {
    const qr = encodeQr(buildQrPayload(box, { mode: 'text', summaryMax }), { ecc: 'M' });
    // מודול אחד של שוליים שקטים מכל צד, בנוסף לשולי המדבקה
    const scale = Math.floor(maxDots / (qr.size + 2));
    best = { qr, scale: Math.max(2, scale) };
    if (scale >= COMFORTABLE_MODULE_DOTS) break;
  }
  return best;
}

/** גלישת טקסט לשורות ברוחב נתון, עם שלוש נקודות כשהטקסט נחתך. */
function wrapText(context, text, maxWidth, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  let truncated = false;

  for (let index = 0; index < words.length; index++) {
    const candidate = line ? `${line} ${words[index]}` : words[index];
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = words[index];
    if (lines.length === maxLines) {
      truncated = true;
      line = '';
      break;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    truncated = true;
  }

  if (truncated && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.replace(/[,\s]+$/, '')}…`;
  }
  lines.truncated = truncated;
  return lines;
}

/** חלוקת התוויות (שביר / פריקה ראשונה) לשורות, כך שלא יגלשו מרוחב הטקסט. */
function layoutMarks(context, marks, areaWidth, smallSize) {
  const padX = Math.round(smallSize * 0.45);
  const gapX = Math.round(smallSize * 0.4);
  const rows = [];
  let row = [];
  let used = 0;
  for (const text of marks) {
    const width = Math.ceil(context.measureText(text).width) + padX * 2;
    if (row.length && used + gapX + width > areaWidth) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push({ text, width });
    used += (row.length > 1 ? gapX : 0) + width;
  }
  if (row.length) rows.push(row);
  return { rows, padX, gapX, rowHeight: Math.round(smallSize * 1.5), rowGap: Math.round(smallSize * 0.3) };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * תכנון גוש הטקסט: גדלי גופן ושורות שנכנסים בשטח הנתון.
 * מתחילים בגודל המרבי ומקטינים בהדרגה עד שהכול נכנס.
 */
function planText(context, box, areaWidth, areaHeight) {
  const marks = [box.fragile ? 'שביר' : '', box.priority === 'high' ? 'פריקה ראשונה' : ''].filter(Boolean);
  const itemsText = (box.items || []).join(', ');
  const MIN_FACTOR = 0.42;
  const STEP = 0.04;

  for (let factor = 1; factor >= MIN_FACTOR; factor -= STEP) {
    const lastChance = factor - STEP < MIN_FACTOR;
    const roomSize = Math.round(clamp(areaHeight * 0.25, 20, 60) * factor);
    const numberSize = Math.round(clamp(areaHeight * 0.21, 20, 52) * factor);
    const smallSize = Math.round(clamp(areaHeight * 0.105, 15, 28) * Math.max(factor, 0.8));
    const gap = Math.round(smallSize * 0.3);

    // שם החדר הוא הפרט החשוב במדבקה: מקטינים גופן לפני שמוותרים על אות ממנו
    context.font = `800 ${roomSize}px ${FONT_STACK}`;
    const roomLines = wrapText(context, box.room || '', areaWidth, 2);
    const roomFits = !roomLines.truncated && roomLines.every((line) => context.measureText(line).width <= areaWidth);

    context.font = `800 ${numberSize}px ${FONT_STACK}`;
    const numberText = box.boxNumber || 'ללא מספר';
    const numberFits = context.measureText(numberText).width <= areaWidth;

    context.font = `800 ${smallSize}px ${FONT_STACK}`;
    const markLayout = layoutMarks(context, marks, areaWidth, smallSize);
    const marksHeight = markLayout.rows.length
      ? markLayout.rows.length * markLayout.rowHeight + (markLayout.rows.length - 1) * markLayout.rowGap
      : 0;

    const fixedHeight =
      roomLines.length * Math.round(roomSize * 1.12) +
      gap +
      Math.round(numberSize * 1.15) +
      (marksHeight ? gap + marksHeight : 0);

    // לתכולה מוקצות כל השורות שנותרו, עד שלוש
    const itemLineHeight = Math.round(smallSize * 1.25);
    const roomForItems = Math.floor((areaHeight - fixedHeight - gap) / itemLineHeight);
    const maxItemLines = clamp(roomForItems, 0, 3);
    context.font = `500 ${smallSize}px ${FONT_STACK}`;
    const itemLines = itemsText && maxItemLines > 0 ? wrapText(context, itemsText, areaWidth, maxItemLines) : [];

    const totalHeight = fixedHeight + (itemLines.length ? gap + itemLines.length * itemLineHeight : 0);
    if ((roomFits && numberFits && totalHeight <= areaHeight) || lastChance) {
      return {
        roomSize, numberSize, smallSize, gap, roomLines, numberText,
        itemLines, itemLineHeight, markLayout, totalHeight,
      };
    }
  }
  return null;
}

function drawText(context, plan, right, top, areaHeight) {
  let y = Math.round(top + Math.max(0, (areaHeight - plan.totalHeight) / 2));

  context.font = `800 ${plan.roomSize}px ${FONT_STACK}`;
  for (const line of plan.roomLines) {
    context.fillText(line, right, y);
    y += Math.round(plan.roomSize * 1.12);
  }
  y += plan.gap;

  context.font = `800 ${plan.numberSize}px ${FONT_STACK}`;
  context.fillText(plan.numberText, right, y);
  y += Math.round(plan.numberSize * 1.15);

  if (plan.itemLines.length) {
    y += plan.gap;
    context.font = `500 ${plan.smallSize}px ${FONT_STACK}`;
    for (const line of plan.itemLines) {
      context.fillText(line, right, y);
      y += plan.itemLineHeight;
    }
  }

  if (plan.markLayout.rows.length) {
    y += plan.gap;
    context.font = `800 ${plan.smallSize}px ${FONT_STACK}`;
    const { rows, padX, gapX, rowHeight, rowGap } = plan.markLayout;
    for (const row of rows) {
      let x = right;
      for (const mark of row) {
        // תווית הפוכה (לבן על שחור) — בולטת מרחוק גם בהדפסה תרמית
        context.fillStyle = '#000000';
        context.fillRect(x - mark.width, y, mark.width, rowHeight);
        context.fillStyle = '#ffffff';
        context.fillText(mark.text, x - padX, y + Math.round(plan.smallSize * 0.2));
        context.fillStyle = '#000000';
        x -= mark.width + gapX;
      }
      y += rowHeight + rowGap;
    }
  }
}

/**
 * ציור מדבקה לקנבס.
 * @param {object} box הארגז
 * @param {{widthDots: number, heightDots: number}} size גודל המדבקה בנקודות
 * @returns {HTMLCanvasElement}
 */
export function renderLabelCanvas(box, { widthDots, heightDots }) {
  // רוחב השורה חייב להתחלק ל-8, כי כל שורה נשלחת כבתים שלמים
  const width = Math.floor(widthDots / 8) * 8;
  const height = Math.round(heightDots);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#000000';
  context.direction = 'rtl';
  context.textAlign = 'right';
  context.textBaseline = 'top';

  const padding = Math.max(8, Math.round(Math.min(width, height) * 0.05));
  const stacked = height >= width * 0.95;

  if (stacked) {
    // מדבקה גבוהה: הטקסט למעלה וקוד ה-QR ממורכז למטה
    const { qr, scale } = fitQr(box, Math.min(width - padding * 2, Math.floor(height * 0.52)));
    const qrDots = qr.size * scale;
    const qrX = Math.round((width - qrDots) / 2);
    const qrY = height - padding - scale - qrDots;
    drawQr(context, qr, qrX, qrY, scale);

    const areaHeight = qrY - scale - padding * 2;
    const plan = planText(context, box, width - padding * 2, areaHeight);
    if (plan) drawText(context, plan, width - padding, padding, areaHeight);
  } else {
    // מדבקה רחבה: קוד ה-QR משמאל והטקסט מימין
    const { qr, scale } = fitQr(box, Math.min(height - padding * 2, Math.floor(width * 0.46)));
    const qrDots = qr.size * scale;
    const qrX = padding + scale;
    const qrY = Math.round((height - qrDots) / 2);
    drawQr(context, qr, qrX, qrY, scale);

    const textLeft = qrX + qrDots + scale + padding;
    const areaWidth = width - padding - textLeft;
    const areaHeight = height - padding * 2;
    const plan = planText(context, box, areaWidth, areaHeight);
    if (plan) drawText(context, plan, width - padding, padding, areaHeight);
  }

  return canvas;
}

function drawQr(context, qr, left, top, scale) {
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) context.fillRect(left + x * scale, top + y * scale, scale, scale);
    }
  }
}

/**
 * המרת הקנבס לשורות של ביטים: בית לכל שמונה נקודות, הביט הגבוה ראשון,
 * 1 = נקודה שחורה. זה הפורמט שמדפסות תרמיות מצפות לו.
 * @returns {{width: number, height: number, rows: Uint8Array[]}}
 */
export function canvasToRows(canvas, { threshold = 150 } = {}) {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const bytesPerRow = width / 8;
  const rows = [];

  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(bytesPerRow);
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const alpha = pixels[offset + 3];
      const luminance =
        alpha === 0 ? 255 : 0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
      if (luminance < threshold) row[x >> 3] |= 0x80 >> (x & 7);
    }
    rows.push(row);
  }
  return { width, height, rows };
}
