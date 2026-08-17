/**
 * settings.js — הגדרות מקומיות של המכשיר (localStorage).
 *
 * ההגדרות אינן מסונכרנות בין המכשירים: לכל טלפון/טאבלט יש שם מכשיר משלו,
 * מדפסת משלו וגודל מדבקה מועדף. כתובת ה-API והסיסמה משותפות, ואפשר להעביר
 * אותן למכשיר חדש בסריקת קוד QR של ההגדרות (ראו ui.js).
 */

import { STORAGE_KEYS, DEFAULT_LABEL_SIZE } from './config.js';

const DEFAULTS = {
  /** כתובת אפליקציית הווב של Google Apps Script. */
  apiUrl: '',
  /** מפתח גישה — חייב להיות זהה למפתח שהוגדר בסקריפט. */
  token: '',
  /** שם ידידותי למכשיר, מופיע בעמודת "עודכן על ידי" בגיליון. */
  deviceName: '',
  /** גודל המדבקה המועדף להדפסה. */
  labelSize: DEFAULT_LABEL_SIZE,
  /** תוכן ה-QR: 'text' — מזהה, חדר ותמצית תכולה. 'url' — קישור לאפליקציה. */
  qrMode: 'text',
  /** רוחב נייר במדפסת התרמית (מ"מ). */
  thermalWidth: 58,
  /** סנכרון אוטומטי פעיל. */
  autoSync: true,
};

let cache = null;

function detectDeviceName() {
  const agent = navigator.userAgent || '';
  if (/tablet|ipad/i.test(agent)) return 'טאבלט';
  if (/android|iphone|mobile/i.test(agent)) return 'טלפון';
  return 'מחשב';
}

/** ההגדרות הנוכחיות (אובייקט לקריאה בלבד — לעדכון יש להשתמש ב-saveSettings). */
export function getSettings() {
  if (cache) return cache;
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || '{}');
  } catch {
    stored = {};
  }
  cache = { ...DEFAULTS, ...stored };
  if (!cache.deviceName) {
    cache.deviceName = `${detectDeviceName()} ${Math.floor(Math.random() * 900 + 100)}`;
    persist();
  }
  return cache;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(cache));
  } catch (error) {
    console.warn('שמירת ההגדרות נכשלה', error);
  }
}

/** עדכון חלקי של ההגדרות. מחזיר את ההגדרות המעודכנות. */
export function saveSettings(partial) {
  cache = { ...getSettings(), ...partial };
  if (typeof cache.apiUrl === 'string') cache.apiUrl = cache.apiUrl.trim();
  if (typeof cache.token === 'string') cache.token = cache.token.trim();
  persist();
  return cache;
}

/** האם המכשיר כבר חובר לגיליון בענן. */
export function isConfigured() {
  return Boolean(getSettings().apiUrl);
}

/**
 * קליטת הגדרות מכתובת ה-URL — מאפשר לחבר מכשיר חדש בקליק אחד
 * (למשל מתוך קוד QR של שיתוף הגדרות): ‎?api=...&token=...
 * הפרמטרים מוסרים מהכתובת מיד אחרי הקליטה כדי לא להשאיר סיסמה בהיסטוריה.
 */
export function adoptSettingsFromUrl() {
  const params = new URLSearchParams(location.search);
  const apiUrl = params.get('api');
  const token = params.get('token');
  if (!apiUrl && !token) return false;

  saveSettings({
    ...(apiUrl ? { apiUrl } : {}),
    ...(token ? { token } : {}),
  });
  params.delete('api');
  params.delete('token');
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash);
  return true;
}
