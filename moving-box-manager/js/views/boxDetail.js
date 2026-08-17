/**
 * views/boxDetail.js — כרטיס הארגז: תצוגה מקדימה של המדבקה, קוד ה-QR
 * והפעולות עליו (הדפסה, עריכה, מחיקה).
 */

import { LABEL_SIZES } from '../config.js';
import { buildQrPayload, markDeleted, roomInfo } from '../boxes.js';
import * as store from '../store.js';
import * as label from '../label.js';
import * as thermal from '../thermal.js';
import { getSettings, saveSettings } from '../settings.js';
import { openModal, close as closeModal, confirmAction, toast } from '../dialogs.js';
import { escapeHtml, formatDateTime, formatRelative, el } from '../util.js';
import { openBoxForm } from './boxForm.js';

export function openBoxDetail(boxId) {
  const box = store.getBox(boxId);
  if (!box) {
    toast('הארגז לא נמצא', { type: 'error' });
    return;
  }

  const settings = getSettings();
  const room = roomInfo(box.room);
  const body = el('div', { class: 'box-detail' });

  const renderBody = () => {
    const current = store.getBox(boxId) || box;
    const payload = buildQrPayload(current, { mode: settings.qrMode });

    body.innerHTML = `
      <div class="label-preview" aria-label="תצוגה מקדימה של המדבקה">
        ${label.renderLabelHtml(current, { sizeId: settings.labelSize, qrMode: settings.qrMode, preview: true })}
      </div>

      <div class="detail-meta">
        <div class="detail-meta__row">
          <span class="chip" style="--room-color:${room.color}">${room.icon} ${escapeHtml(current.room)}</span>
          ${current.fragile ? '<span class="chip chip--warn">⚠️ שביר</span>' : ''}
          ${current.priority === 'high' ? '<span class="chip chip--priority">★ פריקה ראשונה</span>' : ''}
          ${current.dirty ? '<span class="chip chip--pending">⏳ ממתין לסנכרון</span>' : ''}
        </div>
        ${
          current.items?.length
            ? `<div class="item-chips">${current.items
                .map((item) => `<span class="item-chip">${escapeHtml(item)}</span>`)
                .join('')}</div>`
            : '<p class="hint">אין פירוט תכולה</p>'
        }
        ${current.notes ? `<p class="detail-notes">${escapeHtml(current.notes)}</p>` : ''}
        <dl class="detail-facts">
          <div><dt>נוצר</dt><dd>${escapeHtml(formatDateTime(current.createdAt))}</dd></div>
          <div><dt>עודכן</dt><dd>${escapeHtml(formatRelative(current.updatedAt))}</dd></div>
          ${current.updatedBy ? `<div><dt>על ידי</dt><dd>${escapeHtml(current.updatedBy)}</dd></div>` : ''}
        </dl>
        <details class="detail-qr-data">
          <summary>תוכן קוד ה-QR</summary>
          <code>${escapeHtml(payload)}</code>
        </details>
      </div>

      <div class="print-panel">
        <span class="field__label">מידת מדבקה</span>
        <div class="size-chips">
          ${Object.values(LABEL_SIZES)
            .map(
              (size) => `
              <button type="button" class="size-chip" data-size="${size.id}"
                      aria-pressed="${String(size.id === settings.labelSize)}">
                ${escapeHtml(size.label)}
              </button>`
            )
            .join('')}
        </div>
        <div class="print-actions">
          <button type="button" class="button button--primary" data-action="print">🖨️ הדפס מדבקה</button>
          <button type="button" class="button button--ghost" data-action="thermal">📶 מדפסת תרמית</button>
        </div>
      </div>
    `;
  };

  renderBody();

  body.addEventListener('click', async (event) => {
    const sizeButton = event.target.closest('[data-size]');
    if (sizeButton) {
      saveSettings({ labelSize: sizeButton.dataset.size });
      renderBody();
      return;
    }

    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const current = store.getBox(boxId);
    if (!current) return;

    if (actionButton.dataset.action === 'print') {
      const { labelSize, qrMode } = getSettings();
      label.printLabels(current, { sizeId: labelSize, qrMode });
      return;
    }

    if (actionButton.dataset.action === 'thermal') {
      if (!thermal.isSupported()) {
        toast('הדפסה תרמית נתמכת ב-Chrome לאנדרואיד בלבד. השתמשו בכפתור ההדפסה הרגיל.', {
          type: 'error',
          duration: 5000,
        });
        return;
      }
      actionButton.disabled = true;
      try {
        await thermal.printBoxes(current, { widthMm: getSettings().thermalWidth });
        toast(`נשלח למדפסת ${thermal.connectedName() || 'התרמית'}`, { type: 'success' });
      } catch (error) {
        toast(error.message || 'ההדפסה נכשלה', { type: 'error', duration: 5000 });
      } finally {
        actionButton.disabled = false;
      }
    }
  });

  openModal({
    title: box.boxNumber || 'ארגז ללא מספר',
    body,
    size: 'lg',
    actions: [
      {
        label: '🗑️ מחיקה',
        variant: 'danger-ghost',
        onClick: async () => {
          const current = store.getBox(boxId);
          if (!current) return;
          const confirmed = await confirmAction({
            title: 'מחיקת ארגז',
            message: `למחוק את ${current.boxNumber || 'הארגז'}? המחיקה תתעדכן בכל המכשירים.`,
            confirmLabel: 'מחק',
          });
          if (!confirmed) return;
          await store.saveLocal(markDeleted(current, getSettings().deviceName));
          closeModal();
          toast('הארגז נמחק', { type: 'success' });
        },
      },
      {
        label: '✏️ עריכה',
        variant: 'ghost',
        onClick: () => {
          const current = store.getBox(boxId);
          closeModal();
          openBoxForm({ box: current, onSaved: () => openBoxDetail(boxId) });
        },
      },
      { label: 'סגירה', variant: 'primary', onClick: ({ close }) => close() },
    ],
  });
}
