/**
 * dialogs.js — חלונות מודאליים והודעות קצרות.
 * מודול עצמאי ללא תלות בשאר האפליקציה, כדי שכל מסך יוכל להשתמש בו.
 */

import { el } from './util.js';

let openDialog = null;

function ensureRoot(id, className) {
  let root = document.getElementById(id);
  if (!root) {
    root = el('div', { id, class: className });
    document.body.append(root);
  }
  return root;
}

/**
 * פתיחת חלון. גוף החלון יכול להיות אלמנט או מחרוזת HTML.
 * @returns {{close: () => void, element: HTMLElement}}
 */
export function openModal({ title, body, actions = [], onClose, size = 'md', fullscreen = false }) {
  close();

  const root = ensureRoot('modal-root', 'modal-root');
  const content = el('div', { class: `modal modal--${size}${fullscreen ? ' modal--fullscreen' : ''}` });

  const header = el('header', { class: 'modal__header' }, [
    el('h2', { class: 'modal__title' }, [title || '']),
    el('button', {
      class: 'icon-button modal__close',
      type: 'button',
      'aria-label': 'סגירה',
      onclick: () => close(),
    }, ['✕']),
  ]);

  const bodyNode = el('div', { class: 'modal__body' });
  if (typeof body === 'string') bodyNode.innerHTML = body;
  else if (body) bodyNode.append(body);

  content.append(header, bodyNode);

  if (actions.length) {
    const footer = el('footer', { class: 'modal__footer' });
    for (const action of actions) {
      footer.append(
        el('button', {
          class: `button button--${action.variant || 'ghost'}`,
          type: 'button',
          onclick: () => action.onClick?.({ close }),
        }, [action.label])
      );
    }
    content.append(footer);
  }

  const backdrop = el('div', {
    class: 'modal-backdrop',
    onclick: (event) => {
      if (event.target === backdrop) close();
    },
  }, [content]);

  root.append(backdrop);
  document.body.classList.add('is-modal-open');

  const onKeyDown = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKeyDown);

  openDialog = {
    close() {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      if (!root.children.length) document.body.classList.remove('is-modal-open');
      openDialog = null;
      onClose?.();
    },
    element: bodyNode,
  };

  // מיקוד בשדה הראשון — חוסך הקשה בטלפון
  requestAnimationFrame(() => {
    const focusable = bodyNode.querySelector('input, select, textarea, button');
    if (focusable && !fullscreen) focusable.focus({ preventScroll: true });
  });

  return openDialog;
}

export function close() {
  openDialog?.close();
}

export function isOpen() {
  return Boolean(openDialog);
}

/** אישור פעולה — מחזיר Promise שנפתר ל-true/false. */
export function confirmAction({ title, message, confirmLabel = 'אישור', variant = 'danger' }) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };
    openModal({
      title,
      size: 'sm',
      body: el('p', { class: 'modal__message' }, [message]),
      onClose: () => finish(false),
      actions: [
        { label: 'ביטול', variant: 'ghost', onClick: ({ close: closeModal }) => { finish(false); closeModal(); } },
        { label: confirmLabel, variant, onClick: ({ close: closeModal }) => { finish(true); closeModal(); } },
      ],
    });
  });
}

/** הודעה קצרה בתחתית המסך. */
export function toast(message, { type = 'info', duration = 3200 } = {}) {
  const root = ensureRoot('toast-root', 'toast-root');
  const node = el('div', { class: `toast toast--${type}`, role: 'status' }, [message]);
  root.append(node);
  requestAnimationFrame(() => node.classList.add('is-visible'));
  setTimeout(() => {
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), 250);
  }, duration);
}
