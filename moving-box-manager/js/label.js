/**
 * label.js — בניית המדבקה והדפסתה.
 *
 * ההדפסה נעשית דרך מנגנון ההדפסה של הדפדפן, ולכן באנדרואיד היא נפתחת
 * ישירות בשירות ההדפסה של המערכת: מדפסת Wi-Fi‏ / Google Cloud Print‏ /
 * "שמירה כ-PDF". גודל הדף נקבע ב-‎@page לפי מידת המדבקה שנבחרה, כך שה-PDF
 * שנוצר הוא במידות המדבקה המדויקות.
 */

import { LABEL_SIZES } from './config.js';
import { buildQrPayload, itemsSummary, roomInfo } from './boxes.js';
import { qrToSvg } from './qr.js';
import { escapeHtml, formatDateTime } from './util.js';

const PRINT_ROOT_ID = 'print-root';
const PRINT_STYLE_ID = 'print-page-style';

/**
 * HTML של מדבקה בודדת.
 * המבנה זהה במסך ובהדפסה, כך שהתצוגה המקדימה נאמנה לתוצאה.
 */
export function renderLabelHtml(box, { sizeId, qrMode = 'text', preview = false } = {}) {
  const size = LABEL_SIZES[sizeId] || LABEL_SIZES['100x60'];
  const room = roomInfo(box.room);
  const payload = buildQrPayload(box, { mode: qrMode });
  const qr = qrToSvg(payload, { ecc: 'M', margin: 1 });
  const summary = itemsSummary(box, size.widthMm >= 90 ? 110 : 60);
  const badges = [
    box.fragile ? '<span class="label-badge label-badge--fragile">⚠ שביר</span>' : '',
    box.priority === 'high' ? '<span class="label-badge label-badge--priority">★ פריקה ראשונה</span>' : '',
  ].join('');

  return `
    <article class="label label--${size.id}${preview ? ' label--preview' : ''}"
             style="--room-color: ${room.color}">
      <div class="label__main">
        <div class="label__room">${escapeHtml(box.room)}</div>
        <div class="label__number">${escapeHtml(box.boxNumber || 'ללא מספר')}</div>
        <div class="label__items">${escapeHtml(summary) || '&nbsp;'}</div>
        <div class="label__badges">${badges}</div>
      </div>
      <div class="label__qr">
        ${qr}
        <div class="label__date">${escapeHtml(formatDateTime(box.createdAt).split(',')[0] || '')}</div>
      </div>
    </article>
  `;
}

function ensurePrintRoot() {
  let root = document.getElementById(PRINT_ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = PRINT_ROOT_ID;
    document.body.append(root);
  }
  return root;
}

/** הגדרת מידות הדף בפועל — זה מה שהופך את הפלט למדבקה במידה נכונה. */
function setPageSize(size) {
  let style = document.getElementById(PRINT_STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = PRINT_STYLE_ID;
    document.head.append(style);
  }
  style.textContent =
    size.id === 'a4'
      ? '@page { size: A4 portrait; margin: 8mm; }'
      : `@page { size: ${size.widthMm}mm ${size.heightMm}mm; margin: 0; }`;
}

/**
 * הדפסת מדבקות. מקבל ארגז בודד או רשימה — כך אותו מסלול משמש להדפסת
 * מדבקה אחת בזמן האריזה ולהדפסה מרוכזת של חדר שלם.
 */
export function printLabels(boxes, { sizeId, qrMode = 'text' } = {}) {
  const list = [].concat(boxes).filter(Boolean);
  if (!list.length) return;

  const size = LABEL_SIZES[sizeId] || LABEL_SIZES['100x60'];
  const root = ensurePrintRoot();
  setPageSize(size);

  const labels = list.map((box) => renderLabelHtml(box, { sizeId: size.id, qrMode })).join('');
  root.className = `print-root print-root--${size.id}`;
  root.innerHTML = size.id === 'a4' ? `<div class="label-sheet">${labels}</div>` : labels;

  // המתנה לפריסה לפני פתיחת דיאלוג ההדפסה, אחרת אנדרואיד מצלם דף ריק
  requestAnimationFrame(() => {
    requestAnimationFrame(() => window.print());
  });
}

/** ניקוי אזור ההדפסה אחרי סגירת הדיאלוג. */
export function clearPrintRoot() {
  const root = document.getElementById(PRINT_ROOT_ID);
  if (root) root.innerHTML = '';
}
