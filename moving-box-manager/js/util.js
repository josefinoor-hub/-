/**
 * util.js — פונקציות עזר כלליות ללא תלות במצב האפליקציה.
 */

/** מזהה ייחודי לרשומה. עמיד גם בדפדפנים ללא crypto.randomUUID. */
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** בריחה מתווי HTML — כל טקסט שמגיע מהמשתמש עובר דרך כאן. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** השהיית קריאות רצופות — למשל בזמן הקלדה בשדה החיפוש. */
export function debounce(fn, waitMs) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
  debounced.cancel = () => clearTimeout(timer);
  debounced.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  return debounced;
}

/**
 * נרמול טקסט לחיפוש: אותיות סופיות, ניקוד, גרשיים ורווחים כפולים.
 * מאפשר למצוא "ספרים" גם כשהוקלד "ספרים " או "סְפָרִים".
 */
const FINAL_LETTERS = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };

export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '') // ניקוד וטעמי מקרא
    .replace(/[ךםןףץ]/g, (letter) => FINAL_LETTERS[letter])
    .replace(/["'׳״`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** פיצול טקסט חופשי לרשימת פריטים — פסיקים, נקודה-פסיק ושורות חדשות. */
export function splitItems(value) {
  return String(value ?? '')
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** תאריך ושעה בפורמט עברי קריא. */
export function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** תיאור יחסי קצר — "לפני 5 דקות". */
export function formatRelative(iso) {
  if (!iso) return 'מעולם לא';
  const deltaSeconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(deltaSeconds)) return '';
  if (deltaSeconds < 10) return 'עכשיו';
  if (deltaSeconds < 60) return `לפני ${deltaSeconds} שניות`;
  const minutes = Math.round(deltaSeconds / 60);
  if (minutes < 60) return `לפני ${minutes} דקות`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  return formatDateTime(iso);
}

/** המתנה — משמשת לניסיונות חוזרים ולקצב שליחה למדפסת. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** קיצור טקסט עם שלוש נקודות, בלי לחתוך באמצע מילה כשאפשר. */
export function truncate(value, maxChars) {
  const text = String(value ?? '').trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

/** יצירת אלמנט עם מאפיינים וילדים — קיצור קטן במקום document.createElement ידני. */
export function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
