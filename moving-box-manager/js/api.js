/**
 * api.js — לקוח HTTP מול אפליקציית הווב של Google Apps Script.
 *
 * הערה חשובה על CORS: Apps Script אינו מחזיר תשובה לבקשת preflight, ולכן
 * בקשות ה-POST נשלחות עם Content-Type של טקסט פשוט. כך הדפדפן מסווג אותן
 * כבקשות "פשוטות" ושולח אותן ישירות, בלי preflight. הגוף עצמו הוא JSON.
 */

import { SYNC } from './config.js';
import { getSettings } from './settings.js';

/** שגיאה שמבדילה בין תקלת רשת (אפשר לנסות שוב) לבין שגיאת שרת. */
export class ApiError extends Error {
  constructor(message, { network = false, status = 0, code = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.network = network;
    this.status = status;
    this.code = code;
  }
}

function requireApiUrl() {
  const { apiUrl } = getSettings();
  if (!apiUrl) {
    throw new ApiError('לא הוגדרה כתובת שרת. פתחו את ההגדרות והדביקו את כתובת ה-Web App.', {
      code: 'NO_API_URL',
    });
  }
  return apiUrl;
}

async function parseResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    // Apps Script מחזיר דף HTML כשההרשאות שגויות או שהפריסה אינה ציבורית
    throw new ApiError(
      'השרת החזיר תשובה לא צפויה. ודאו שהפריסה מוגדרת "Anyone" ושהכתובת מסתיימת ב-/exec',
      { status: response.status, code: 'BAD_RESPONSE' }
    );
  }
  if (!payload.ok) {
    throw new ApiError(payload.error || 'שגיאה לא ידועה מהשרת', {
      status: response.status,
      code: payload.code || 'SERVER_ERROR',
    });
  }
  return payload;
}

async function request(method, action, payload = {}) {
  const apiUrl = requireApiUrl();
  const { token } = getSettings();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SYNC.REQUEST_TIMEOUT_MS);

  try {
    let response;
    if (method === 'GET') {
      const url = new URL(apiUrl);
      url.searchParams.set('action', action);
      if (token) url.searchParams.set('token', token);
      for (const [key, value] of Object.entries(payload)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
      response = await fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
      });
    } else {
      response = await fetch(apiUrl, {
        method: 'POST',
        // טקסט פשוט במכוון — ראו ההערה בראש הקובץ
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token, ...payload }),
        signal: controller.signal,
        redirect: 'follow',
      });
    }

    if (!response.ok) {
      throw new ApiError(`השרת החזיר שגיאה (${response.status})`, {
        status: response.status,
        code: 'HTTP_ERROR',
      });
    }
    return await parseResponse(response);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') {
      throw new ApiError('הבקשה לשרת ארכה זמן רב מדי', { network: true, code: 'TIMEOUT' });
    }
    throw new ApiError('אין חיבור לשרת. השינויים נשמרו במכשיר ויסונכרנו אוטומטית.', {
      network: true,
      code: 'NETWORK',
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** בדיקת חיבור והרשאות מול השרת. */
export function ping() {
  return request('GET', 'ping');
}

/**
 * משיכת כל השינויים שנעשו מאז הסמן שהתקבל בפעם הקודמת.
 * @param {number} since סמן (seq) אחרון שידוע ללקוח
 */
export function pull(since = 0) {
  return request('GET', 'pull', { since });
}

/**
 * דחיפת רשומות שהשתנו במכשיר. השרת מיישב התנגשויות ומחזיר את הגרסה הקובעת.
 * @param {Array<object>} boxes
 */
export function push(boxes) {
  return request('POST', 'push', { boxes, device: getSettings().deviceName });
}

/**
 * שריון בלוק של מספרי ארגז רציפים למכשיר הזה.
 * כך אפשר ליצור ארגזים גם ללא רשת בלי להתנגש במכשירים אחרים.
 */
export function reserveNumbers(count) {
  return request('POST', 'reserve', { count, device: getSettings().deviceName });
}

/** יצירת גיבוי מיידי של הגיליון בתיקייה ב-Google Drive. */
export function createBackup() {
  return request('POST', 'backup', {});
}
