/**
 * views/scan.js — מסך סריקת QR. סריקה מוצלחת פותחת מיד את כרטיס הארגז.
 */

import * as scanner from '../scanner.js';
import * as store from '../store.js';
import { parseScan } from '../boxes.js';
import { openModal, close as closeModal, toast } from '../dialogs.js';
import { el } from '../util.js';
import { openBoxDetail } from './boxDetail.js';

const RESCAN_COOLDOWN_MS = 2000;

export function openScanner() {
  const video = el('video', { class: 'scanner__video', muted: true, playsinline: true });
  const body = el('div', { class: 'scanner' }, [
    el('div', { class: 'scanner__viewport' }, [video, el('div', { class: 'scanner__frame' })]),
    el('p', { class: 'scanner__hint' }, ['כוונו את המצלמה לקוד שעל הארגז']),
  ]);

  const manualForm = createManualEntry((value) => handleResult(value, { manual: true }));
  body.append(manualForm);

  let session = null;
  let lastValue = '';
  let lastTime = 0;

  const dialog = openModal({
    title: 'סריקת ארגז',
    body,
    size: 'lg',
    fullscreen: true,
    onClose: () => session?.stop(),
    actions: [{ label: 'סגירה', variant: 'ghost', onClick: ({ close }) => close() }],
  });

  scanner
    .start(video, (value) => handleResult(value, { manual: false }))
    .then((activeSession) => {
      session = activeSession;
      addTorchButton(body, activeSession);
    })
    .catch((error) => {
      body.querySelector('.scanner__viewport')?.remove();
      body.querySelector('.scanner__hint').textContent = error.message;
      body.querySelector('.scanner__hint').classList.add('scanner__hint--error');
      manualForm.querySelector('input')?.focus();
    });

  function handleResult(value, { manual }) {
    const now = Date.now();
    if (!manual && value === lastValue && now - lastTime < RESCAN_COOLDOWN_MS) return;
    lastValue = value;
    lastTime = now;

    const parsed = parseScan(value);
    if (!parsed?.boxNumber) {
      toast('הקוד שנסרק אינו קוד ארגז מוכר', { type: 'error' });
      return;
    }

    const box = store.findByNumber(parsed.boxNumber);
    if (!box) {
      toast(`${parsed.boxNumber} לא נמצא ברשימה. נסו לסנכרן.`, { type: 'error', duration: 4000 });
      return;
    }

    navigator.vibrate?.(60);
    session?.stop();
    closeModal();
    openBoxDetail(box.id);
  }

  return dialog;
}

function createManualEntry(onSubmit) {
  const input = el('input', {
    class: 'input',
    type: 'text',
    inputmode: 'numeric',
    placeholder: 'או הקלידו מספר ארגז, למשל 12',
    'aria-label': 'מספר ארגז',
  });
  const form = el('form', { class: 'scanner__manual' }, [
    input,
    el('button', { class: 'button button--primary', type: 'submit' }, ['חיפוש']),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (value) onSubmit(value);
  });
  return form;
}

function addTorchButton(body, session) {
  const button = el('button', {
    class: 'button button--ghost scanner__torch',
    type: 'button',
    onclick: async () => {
      const on = await session.toggleTorch();
      button.textContent = on ? '🔦 כיבוי פנס' : '🔦 הדלקת פנס';
    },
  }, ['🔦 הדלקת פנס']);
  body.querySelector('.scanner__viewport')?.append(button);
}
