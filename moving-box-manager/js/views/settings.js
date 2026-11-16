/**
 * views/settings.js — חיבור לגיליון, העדפות מכשיר וכלי תחזוקה.
 */

import { LABEL_SIZES } from '../config.js';
import * as api from '../api.js';
import * as sync from '../sync.js';
import * as store from '../store.js';
import * as numbers from '../numbers.js';
import * as printer from '../printer.js';
import { NIIMBOT_LABELS, PRINTER_TYPES } from '../config.js';
import { getSettings, saveSettings } from '../settings.js';
import { qrToSvg } from '../qr.js';
import { openModal, confirmAction, toast } from '../dialogs.js';
import { activeBoxesCsv } from '../export.js';
import { el, escapeHtml, formatRelative } from '../util.js';

export function openSettings() {
  const settings = getSettings();
  const body = el('div', { class: 'settings' });

  body.innerHTML = `
    <section class="settings__section">
      <h3>חיבור לגיליון בענן</h3>
      <p class="hint">
        הדביקו את הכתובת שקיבלתם בפריסת ה-Web App ב-Google Apps Script (מסתיימת ב-‎/exec).
        כל המכשירים שמחוברים לאותה כתובת רואים את אותם ארגזים.
      </p>
      <label class="field">
        <span class="field__label">כתובת שרת (Web App URL)</span>
        <input class="input" type="url" name="apiUrl" dir="ltr" spellcheck="false"
               placeholder="https://script.google.com/macros/s/.../exec"
               value="${escapeHtml(settings.apiUrl)}">
      </label>
      <label class="field">
        <span class="field__label">מפתח גישה</span>
        <input class="input" type="text" name="token" dir="ltr" spellcheck="false"
               placeholder="הסיסמה שהוגדרה בסקריפט" value="${escapeHtml(settings.token)}">
      </label>
      <div class="settings__buttons">
        <button type="button" class="button button--primary" data-action="save-connection">שמירה ובדיקה</button>
        <button type="button" class="button button--ghost" data-action="share">📱 חיבור מכשיר נוסף</button>
      </div>
    </section>

    <section class="settings__section">
      <h3>סנכרון</h3>
      <div class="settings__status" data-role="sync-status"></div>
      <div class="settings__buttons">
        <button type="button" class="button button--ghost" data-action="sync">🔄 סנכרון עכשיו</button>
        <button type="button" class="button button--ghost" data-action="backup">☁️ גיבוי ל-Drive</button>
        <button type="button" class="button button--ghost" data-action="export">⬇️ ייצוא CSV</button>
      </div>
    </section>

    <section class="settings__section">
      <h3>העדפות מכשיר</h3>
      <label class="field">
        <span class="field__label">שם המכשיר (מופיע בגיליון)</span>
        <input class="input" type="text" name="deviceName" value="${escapeHtml(settings.deviceName)}">
      </label>
      <label class="field">
        <span class="field__label">מידת מדבקה מועדפת</span>
        <select class="input" name="labelSize">
          ${Object.values(LABEL_SIZES)
            .map(
              (size) =>
                `<option value="${size.id}" ${size.id === settings.labelSize ? 'selected' : ''}>${escapeHtml(
                  size.label
                )}</option>`
            )
            .join('')}
        </select>
      </label>
      <label class="field">
        <span class="field__label">תוכן קוד ה-QR</span>
        <select class="input" name="qrMode">
          <option value="text" ${settings.qrMode === 'text' ? 'selected' : ''}>מזהה + חדר + תמצית תכולה</option>
          <option value="url" ${settings.qrMode === 'url' ? 'selected' : ''}>קישור שפותח את הארגז</option>
        </select>
      </label>
      <label class="field">
        <span class="field__label">סוג מדפסת</span>
        <select class="input" name="printerType">
          ${Object.entries(PRINTER_TYPES)
            .map(([id, label]) => `<option value="${id}" ${settings.printerType === id ? 'selected' : ''}>${escapeHtml(label)}</option>`)
            .join('')}
        </select>
      </label>
      <div data-role="niimbot-settings" ${settings.printerType !== 'niimbot' ? 'hidden' : ''}>
        <label class="field">
          <span class="field__label">מידת מדבקה NIIMBOT</span>
          <select class="input" name="niimbotLabel">
            ${Object.entries(NIIMBOT_LABELS)
              .map(([id, info]) => `<option value="${id}" ${settings.niimbotLabel === id ? 'selected' : ''}>${escapeHtml(info.label)}</option>`)
              .join('')}
          </select>
        </label>
        <label class="field">
          <span class="field__label">כהות הדפסה (1-5)</span>
          <input class="input" type="range" name="niimbotDensity" min="1" max="5" step="1" value="${settings.niimbotDensity}">
        </label>
      </div>
      <div data-role="escpos-settings" ${settings.printerType !== 'escpos' ? 'hidden' : ''}>
        <label class="field">
          <span class="field__label">רוחב נייר</span>
          <select class="input" name="thermalWidth">
            <option value="58" ${Number(settings.thermalWidth) === 58 ? 'selected' : ''}>58 מ"מ</option>
            <option value="80" ${Number(settings.thermalWidth) === 80 ? 'selected' : ''}>80 מ"מ</option>
          </select>
        </label>
      </div>
      <div class="settings__buttons">
        <button type="button" class="button button--ghost" data-action="printer-connect">
          🔗 חיבור מדפסת
        </button>
        <button type="button" class="button button--ghost" data-action="printer-test">
          🖨️ הדפסת בדיקה
        </button>
      </div>
    </section>

    <section class="settings__section settings__section--danger">
      <h3>תחזוקה</h3>
      <p class="hint" data-role="pool"></p>
      <div class="settings__buttons">
        <button type="button" class="button button--danger-ghost" data-action="reset">
          ניקוי המטמון וטעינה מחדש מהגיליון
        </button>
      </div>
    </section>
  `;

  const statusNode = body.querySelector('[data-role="sync-status"]');
  const poolNode = body.querySelector('[data-role="pool"]');

  const renderStatus = async () => {
    const { status, lastSyncAt, pendingCount, error } = store.state.sync;
    const labels = {
      synced: '✅ מסונכרן',
      syncing: '🔄 מסנכרן…',
      offline: '📴 אין רשת — השינויים שמורים במכשיר',
      error: '⚠️ שגיאת סנכרון',
      unconfigured: '⚙️ לא הוגדרה כתובת שרת',
      idle: '⏳ ממתין',
    };
    statusNode.innerHTML = `
      <div>${labels[status] || status}</div>
      <div class="hint">סנכרון אחרון: ${escapeHtml(formatRelative(lastSyncAt))}</div>
      ${pendingCount ? `<div class="hint">${pendingCount} שינויים ממתינים לשליחה</div>` : ''}
      ${error ? `<div class="hint hint--error">${escapeHtml(error)}</div>` : ''}
    `;
    const available = await numbers.available();
    poolNode.textContent = `מספרי ארגז שמורים מראש במכשיר: ${available} (מאפשרים יצירת ארגזים גם ללא רשת)`;
  };

  renderStatus();
  const unsubscribe = store.subscribe(renderStatus);

  const readField = (name) => body.querySelector(`[name="${name}"]`)?.value ?? '';

  // שמירת העדפות מיידית בכל שינוי — בלי כפתור שמירה נפרד
  body.addEventListener('change', (event) => {
    const { name, value } = event.target;
    const numberFields = new Set(['thermalWidth', 'niimbotDensity']);
    if (['deviceName', 'labelSize', 'qrMode', 'thermalWidth', 'printerType', 'niimbotLabel', 'niimbotDensity'].includes(name)) {
      saveSettings({ [name]: numberFields.has(name) ? Number(value) : value });
      if (name === 'printerType') {
        body.querySelector('[data-role="niimbot-settings"]').hidden = value !== 'niimbot';
        body.querySelector('[data-role="escpos-settings"]').hidden = value !== 'escpos';
      }
      toast('ההעדפה נשמרה', { duration: 1500 });
    }
  });

  body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action } = button.dataset;
    button.disabled = true;

    try {
      if (action === 'save-connection') {
        saveSettings({ apiUrl: readField('apiUrl'), token: readField('token') });
        const response = await api.ping();
        toast(`החיבור הצליח — ${response.rows ?? 0} ארגזים בגיליון`, { type: 'success' });
        await numbers.refill();
        await sync.resyncFromScratch();
      }

      if (action === 'share') shareConnection();

      if (action === 'sync') {
        const ok = await sync.syncNow({ reason: 'manual' });
        toast(ok ? 'הסנכרון הושלם' : 'הסנכרון לא הושלם — ראו את הסטטוס', {
          type: ok ? 'success' : 'error',
        });
      }

      if (action === 'backup') {
        const response = await api.createBackup();
        toast(`נוצר גיבוי: ${response.name || 'הגיליון הועתק ל-Drive'}`, { type: 'success' });
      }

      if (action === 'export') exportCsv();

      if (action === 'printer-connect') {
        await printer.connect();
        toast(`מחובר ל-${printer.connectedName() || printer.typeLabel()}`, { type: 'success' });
      }

      if (action === 'printer-test') {
        const { printOnLabelPrinter, sampleBox } = await import('./printFlow.js');
        await printOnLabelPrinter(sampleBox(), { button });
      }

      if (action === 'reset') {
        const confirmed = await confirmAction({
          title: 'ניקוי המטמון',
          message:
            'הנתונים ייטענו מחדש מהגיליון. שינויים שטרם סונכרנו יאבדו. להמשיך?',
          confirmLabel: 'נקה וטען מחדש',
        });
        if (confirmed) {
          await store.resetLocal();
          await numbers.reset();
          await sync.resyncFromScratch();
          toast('המטמון נוקה והנתונים נטענו מחדש', { type: 'success' });
        }
      }
    } catch (error) {
      toast(error.message || 'הפעולה נכשלה', { type: 'error', duration: 5000 });
    } finally {
      button.disabled = false;
    }
  });

  openModal({
    title: 'הגדרות',
    body,
    size: 'lg',
    onClose: unsubscribe,
    actions: [{ label: 'סגירה', variant: 'primary', onClick: ({ close }) => close() }],
  });
}

/** קוד QR שמחבר מכשיר נוסף לאותו גיליון בסריקה אחת. */
function shareConnection() {
  const { apiUrl, token } = getSettings();
  if (!apiUrl) {
    toast('קודם הגדירו כתובת שרת', { type: 'error' });
    return;
  }
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set('api', apiUrl);
  if (token) url.searchParams.set('token', token);

  openModal({
    title: 'חיבור מכשיר נוסף',
    size: 'md',
    body: `
      <p class="hint">
        סרקו את הקוד במכשיר החדש (במצלמה הרגילה) — הוא ייפתח עם החיבור לגיליון מוכן.
      </p>
      <div class="share-qr">${qrToSvg(url.toString(), { ecc: 'M', margin: 2 })}</div>
      <p class="hint hint--warn">הקוד מכיל את מפתח הגישה — אל תשתפו אותו מחוץ למשפחה.</p>
    `,
    actions: [{ label: 'סגירה', variant: 'primary', onClick: ({ close }) => close() }],
  });
}

/** ייצוא כל הארגזים לקובץ CSV שנפתח ב-Excel ובגיליונות Google. */
function exportCsv() {
  const csv = activeBoxesCsv(store.activeBoxes());
  // BOM כדי ש-Excel יזהה עברית ב-UTF-8
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a', {
    href: url,
    download: `ארגזים-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('הקובץ הורד', { type: 'success' });
}
