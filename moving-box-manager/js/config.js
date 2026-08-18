/**
 * config.js — קבועים והגדרות ברירת מחדל של האפליקציה.
 * זהו המקום היחיד לשינוי רשימת החדרים, קצב הסנכרון ומידות המדבקות.
 */

/** רשימת החדרים/הקטגוריות הקבועה. שינוי כאן משנה את כל האפליקציה. */
export const ROOMS = [
  { name: 'חדר נעם', icon: '🛏️', color: '#3b82f6' },
  { name: 'חדר עינב', icon: '🛏️', color: '#8b5cf6' },
  { name: 'חדר ענבל', icon: '🛏️', color: '#ec4899' },
  { name: 'חדר כביסה', icon: '🧺', color: '#06b6d4' },
  { name: 'מרפסת', icon: '🪴', color: '#22c55e' },
  { name: 'חדר נכדים', icon: '🧸', color: '#f97316' },
  { name: 'מטבח', icon: '🍳', color: '#ef4444' },
  { name: 'פינת אוכל', icon: '🍽️', color: '#f59e0b' },
  { name: 'סלון', icon: '🛋️', color: '#14b8a6' },
  { name: 'שירותים בכניסה', icon: '🚻', color: '#64748b' },
  { name: 'שירותים למעלה', icon: '🚻', color: '#78716c' },
  { name: 'חדר שינה', icon: '🛌', color: '#6366f1' },
  { name: 'ארונות בגדים חדר שינה', icon: '👗', color: '#a855f7' },
  { name: 'ארונות בחדרים למעלה', icon: '🚪', color: '#0ea5e9' },
  { name: 'שירותי הורים ומקלחת', icon: '🚿', color: '#0891b2' },
  { name: 'שידה הורים', icon: '🗄️', color: '#b45309' },
  { name: 'פינת מחשב יוסי', icon: '💻', color: '#475569' },
];

export const ROOM_NAMES = ROOMS.map((room) => room.name);

/** מפה מהירה משם חדר לפרטי התצוגה שלו. */
export const ROOM_BY_NAME = new Map(ROOMS.map((room) => [room.name, room]));

/** פרטי תצוגה לחדר שאינו ברשימה (למשל אחרי שינוי הרשימה). */
export const UNKNOWN_ROOM = { name: 'ללא חדר', icon: '📦', color: '#94a3b8' };

export const PRIORITY = {
  HIGH: 'high',
  NORMAL: 'normal',
};

export const PRIORITY_LABELS = {
  [PRIORITY.HIGH]: 'עדיפות גבוהה',
  [PRIORITY.NORMAL]: 'עדיפות רגילה',
};

/** תחילית מזהה הארגז — BOX-001, BOX-002 ... */
export const BOX_PREFIX = 'BOX';
export const BOX_NUMBER_PADDING = 3;

/** תחילית מחרוזת ה-QR, כולל מספר גרסת פורמט לתאימות עתידית. */
export const QR_PREFIX = 'MBX1';

/** אורך מרבי של תמצית התכולה בתוך ה-QR ובמדבקה. */
export const QR_SUMMARY_MAX_CHARS = 70;

/** הגדרות מנוע הסנכרון. */
export const SYNC = {
  /** מרווח בין משיכות מהשרת כשהאפליקציה פתוחה על המסך (מילישניות). */
  POLL_INTERVAL_MS: 6000,
  /** מרווח מוארך כשהאפליקציה ברקע. */
  BACKGROUND_POLL_INTERVAL_MS: 60000,
  /** השהיה לפני דחיפת שינויים, כדי לאגד הקלדות רצופות. */
  PUSH_DEBOUNCE_MS: 800,
  /** השהיית בסיס לניסיון חוזר אחרי כשל רשת, גדלה אקספוננציאלית. */
  RETRY_BASE_MS: 2000,
  RETRY_MAX_MS: 60000,
  /** כמה מספרי ארגז לשריין מראש, כדי לאפשר יצירת ארגזים גם ללא רשת. */
  NUMBER_POOL_SIZE: 40,
  NUMBER_POOL_REFILL_THRESHOLD: 12,
  /** פסק זמן לבקשת רשת בודדת. */
  REQUEST_TIMEOUT_MS: 20000,
};

/** מידות מדבקה נתמכות להדפסה. */
export const LABEL_SIZES = {
  '50x30': {
    id: '50x30',
    label: 'מדבקה 50×30 מ"מ',
    widthMm: 50,
    heightMm: 30,
    perPage: 1,
    description: 'מדבקה בודדת קטנה — מדפסת מדבקות',
  },
  '100x60': {
    id: '100x60',
    label: 'מדבקה 100×60 מ"מ',
    widthMm: 100,
    heightMm: 60,
    perPage: 1,
    description: 'מדבקה בודדת גדולה — קריאה מרחוק',
  },
  a4: {
    id: 'a4',
    label: 'גיליון A4 (8 מדבקות בעמוד)',
    widthMm: 95,
    heightMm: 65,
    perPage: 8,
    columns: 2,
    description: 'הדפסה מרוכזת של הרבה ארגזים על דף רגיל',
  },
};

export const DEFAULT_LABEL_SIZE = '100x60';

/** רוחב ההדפסה בנקודות עבור מדפסות תרמיות נפוצות. */
export const THERMAL_WIDTHS = {
  58: 384,
  80: 576,
};

/** מזהי שירות BLE נפוצים של מדפסות תרמיות ניידות. */
export const THERMAL_BLE_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

/** מפתחות אחסון מקומי. */
export const STORAGE_KEYS = {
  SETTINGS: 'mbm.settings.v1',
};

export const DB = {
  NAME: 'moving-box-manager',
  VERSION: 1,
  STORE_BOXES: 'boxes',
  STORE_META: 'meta',
};
