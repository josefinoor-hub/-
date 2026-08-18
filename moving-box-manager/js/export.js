/**
 * export.js — ייצוא הארגזים לקובץ CSV.
 */

import { PRIORITY_LABELS } from './config.js';
import { formatDateTime } from './util.js';

const COLUMNS = [
  ['מספר ארגז', (box) => box.boxNumber || ''],
  ['חדר', (box) => box.room || ''],
  ['תכולה', (box) => (box.items || []).join(', ')],
  ['שביר', (box) => (box.fragile ? 'כן' : 'לא')],
  ['עדיפות', (box) => PRIORITY_LABELS[box.priority] || ''],
  ['הערות', (box) => box.notes || ''],
  ['נוצר', (box) => formatDateTime(box.createdAt)],
  ['עודכן', (box) => formatDateTime(box.updatedAt)],
  ['עודכן על ידי', (box) => box.updatedBy || ''],
];

/** ציטוט תא בתקן CSV — מטפל בפסיקים, גרשיים ושורות חדשות. */
function quote(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function activeBoxesCsv(boxes) {
  const header = COLUMNS.map(([title]) => quote(title)).join(',');
  const rows = [...boxes]
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    .map((box) => COLUMNS.map(([, read]) => quote(read(box))).join(','));
  return [header, ...rows].join('\r\n');
}
