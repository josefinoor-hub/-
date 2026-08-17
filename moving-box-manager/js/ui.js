/**
 * ui.js — מעטפת האפליקציה: חיפוש, תצוגת הארגזים והניווט בין המסכים.
 *
 * הרינדור פשוט בכוונה: בכל שינוי מצב נבנית מחדש רשימת הארגזים. בכמויות
 * הרלוונטיות למעבר דירה (מאות ארגזים) זה מיידי, והקוד נשאר קל למעקב.
 */

import { LABEL_SIZES, ROOMS } from './config.js';
import { groupByRoom, roomInfo, searchBoxes, statistics } from './boxes.js';
import * as store from './store.js';
import * as label from './label.js';
import { getSettings, isConfigured } from './settings.js';
import { toast } from './dialogs.js';
import { debounce, escapeHtml, formatRelative, truncate } from './util.js';
import { openBoxForm } from './views/boxForm.js';
import { openBoxDetail } from './views/boxDetail.js';
import { openScanner } from './views/scan.js';
import { openSettings } from './views/settings.js';

const view = {
  query: '',
  mode: 'rooms', // 'rooms' | 'list'
  collapsedRooms: new Set(),
};

let elements = {};

export function mount(root) {
  root.innerHTML = `
    <header class="app-header">
      <div class="app-header__top">
        <h1 class="app-header__title">📦 ניהול ארגזים</h1>
        <div class="app-header__actions">
          <button type="button" class="sync-chip" data-action="settings" aria-label="מצב סנכרון והגדרות">
            <span class="sync-chip__dot"></span>
            <span class="sync-chip__text">מתחבר…</span>
          </button>
        </div>
      </div>

      <div class="search-bar">
        <span class="search-bar__icon" aria-hidden="true">🔍</span>
        <input type="search" class="search-bar__input" data-role="search" enterkeyhint="search"
               placeholder="חיפוש פריט, חדר או מספר" aria-label="חיפוש">
        <button type="button" class="search-bar__clear" data-action="clear-search" aria-label="ניקוי חיפוש" hidden>✕</button>
        <button type="button" class="search-bar__scan" data-action="scan" aria-label="סריקת קוד QR">📷</button>
      </div>

      <div class="stats-row" data-role="stats"></div>

      <div class="view-toggle" role="tablist" aria-label="אופן תצוגה">
        <button type="button" class="view-toggle__button" data-mode="rooms" role="tab">לפי חדרים</button>
        <button type="button" class="view-toggle__button" data-mode="list" role="tab">רשימה מלאה</button>
      </div>
    </header>

    <main class="app-content" data-role="content"></main>

    <button type="button" class="fab" data-action="add">
      <span class="fab__icon" aria-hidden="true">＋</span>
      <span class="fab__label">הוסף ארגז חדש</span>
    </button>
  `;

  elements = {
    search: root.querySelector('[data-role="search"]'),
    clearSearch: root.querySelector('[data-action="clear-search"]'),
    stats: root.querySelector('[data-role="stats"]'),
    content: root.querySelector('[data-role="content"]'),
    syncChip: root.querySelector('.sync-chip'),
    syncText: root.querySelector('.sync-chip__text'),
    toggles: [...root.querySelectorAll('.view-toggle__button')],
  };

  wireEvents(root);
  store.subscribe(render);
  window.addEventListener('hashchange', handleRoute);
  render();
  handleRoute();
}

function wireEvents(root) {
  const onSearch = debounce(() => {
    view.query = elements.search.value.trim();
    elements.clearSearch.hidden = !view.query;
    render();
  }, 120);
  elements.search.addEventListener('input', onSearch);

  root.addEventListener('click', (event) => {
    const actionNode = event.target.closest('[data-action]');
    if (actionNode) {
      const { action } = actionNode.dataset;
      if (action === 'add') return openBoxForm({ onSaved: (box) => openBoxDetail(box.id) });
      if (action === 'scan') return openScanner();
      if (action === 'settings') return openSettings();
      if (action === 'clear-search') {
        elements.search.value = '';
        view.query = '';
        elements.clearSearch.hidden = true;
        return render();
      }
      if (action === 'print-room') return printRoom(actionNode.dataset.room);
      if (action === 'toggle-room') {
        const { room } = actionNode.dataset;
        if (view.collapsedRooms.has(room)) view.collapsedRooms.delete(room);
        else view.collapsedRooms.add(room);
        return render();
      }
    }

    const modeButton = event.target.closest('[data-mode]');
    if (modeButton) {
      view.mode = modeButton.dataset.mode;
      return render();
    }

    const card = event.target.closest('[data-box-id]');
    if (card) openBoxDetail(card.dataset.boxId);
  });
}

/**
 * ניתוב לפי כתובת:
 *   ‎#/box/BOX-001 — פותח ישירות את הארגז (למשל מקוד QR מסוג קישור)
 *   ‎#/new, ‎#/scan — קיצורי הדרך של האפליקציה המותקנת
 */
function handleRoute() {
  const hash = location.hash;
  if (!hash || hash === '#/') return;
  const clearHash = () => history.replaceState(null, '', location.pathname + location.search);

  if (hash === '#/new') {
    clearHash();
    return openBoxForm({ onSaved: (box) => openBoxDetail(box.id) });
  }
  if (hash === '#/scan') {
    clearHash();
    return openScanner();
  }

  const match = hash.match(/^#\/box\/(.+)$/);
  if (!match) return;
  const box = store.findByNumber(decodeURIComponent(match[1]));
  clearHash();
  if (box) openBoxDetail(box.id);
  else toast('הארגז לא נמצא במכשיר הזה. נסו לסנכרן.', { type: 'error' });
}

function render() {
  renderSyncChip();
  const boxes = store.activeBoxes();
  const results = searchBoxes(boxes, view.query);

  renderStats(boxes, results);
  for (const button of elements.toggles) {
    button.setAttribute('aria-selected', String(button.dataset.mode === view.mode));
  }

  if (!store.state.loaded) {
    elements.content.innerHTML = '<p class="empty">טוען…</p>';
    return;
  }
  if (!boxes.length) {
    elements.content.innerHTML = emptyStateHtml();
    return;
  }
  if (!results.length) {
    elements.content.innerHTML = `<p class="empty">לא נמצאו ארגזים עבור "${escapeHtml(view.query)}"</p>`;
    return;
  }

  elements.content.innerHTML =
    view.mode === 'rooms' ? roomsViewHtml(results) : `<div class="box-grid">${results.map(boxCardHtml).join('')}</div>`;
}

function renderSyncChip() {
  const { status, pendingCount, lastSyncAt } = store.state.sync;
  const texts = {
    synced: `מסונכרן · ${formatRelative(lastSyncAt)}`,
    syncing: 'מסנכרן…',
    offline: pendingCount ? `לא מקוון · ${pendingCount} ממתינים` : 'לא מקוון',
    error: 'שגיאת סנכרון',
    unconfigured: 'חיבור לגיליון',
    idle: 'ממתין',
  };
  elements.syncChip.dataset.status = status;
  elements.syncText.textContent = texts[status] || status;
}

function renderStats(boxes, results) {
  const stats = statistics(boxes);
  const filtered = view.query && results.length !== boxes.length;
  elements.stats.innerHTML = `
    <span class="stat"><b>${filtered ? results.length : stats.total}</b> ${filtered ? 'תוצאות' : 'ארגזים'}</span>
    <span class="stat"><b>${stats.rooms}</b> חדרים</span>
    <span class="stat stat--warn"><b>${stats.fragile}</b> שבירים</span>
    <span class="stat stat--priority"><b>${stats.highPriority}</b> בעדיפות</span>
    ${stats.unnumbered ? `<span class="stat stat--pending"><b>${stats.unnumbered}</b> ללא מספר</span>` : ''}
  `;
}

function emptyStateHtml() {
  return `
    <div class="empty-state">
      <div class="empty-state__icon">📦</div>
      <h2>עדיין אין ארגזים</h2>
      <p>התחילו מהכפתור "הוסף ארגז חדש" — בחרו חדר, כתבו מה נכנס לארגז, והדפיסו מדבקה עם קוד QR.</p>
      ${
        isConfigured()
          ? ''
          : '<p class="hint hint--warn">האפליקציה עדיין לא מחוברת לגיליון. פתחו את ההגדרות כדי לסנכרן בין המכשירים.</p>'
      }
    </div>
  `;
}

function roomsViewHtml(boxes) {
  const groups = groupByRoom(boxes);
  const orderedRooms = [
    ...ROOMS.map((room) => room.name).filter((name) => groups.has(name)),
    ...[...groups.keys()].filter((name) => !ROOMS.some((room) => room.name === name)),
  ];

  return orderedRooms
    .map((name) => {
      const roomBoxes = groups.get(name);
      const info = roomInfo(name);
      const collapsed = view.collapsedRooms.has(name);
      return `
        <section class="room-section${collapsed ? ' is-collapsed' : ''}" style="--room-color:${info.color}">
          <header class="room-section__header">
            <button type="button" class="room-section__toggle" data-action="toggle-room" data-room="${escapeHtml(name)}"
                    aria-expanded="${String(!collapsed)}">
              <span class="room-section__icon">${info.icon}</span>
              <span class="room-section__name">${escapeHtml(name)}</span>
              <span class="room-section__count">${roomBoxes.length}</span>
            </button>
            <button type="button" class="icon-button" data-action="print-room" data-room="${escapeHtml(name)}"
                    aria-label="הדפסת כל המדבקות של ${escapeHtml(name)}">🖨️</button>
          </header>
          ${collapsed ? '' : `<div class="box-grid">${roomBoxes.map(boxCardHtml).join('')}</div>`}
        </section>
      `;
    })
    .join('');
}

function boxCardHtml(box) {
  const info = roomInfo(box.room);
  const items = (box.items || []).join(', ');
  return `
    <article class="box-card" data-box-id="${escapeHtml(box.id)}" style="--room-color:${info.color}"
             role="button" tabindex="0">
      <div class="box-card__head">
        <span class="box-card__number">${escapeHtml(box.boxNumber || 'ללא מספר')}</span>
        <span class="box-card__flags">
          ${box.fragile ? '<span title="שביר">⚠️</span>' : ''}
          ${box.priority === 'high' ? '<span title="עדיפות פריקה גבוהה">★</span>' : ''}
          ${box.dirty ? '<span title="ממתין לסנכרון">⏳</span>' : ''}
        </span>
      </div>
      <div class="box-card__room">${info.icon} ${escapeHtml(box.room)}</div>
      <div class="box-card__items">${escapeHtml(truncate(items, 70)) || '<span class="hint">ללא פירוט</span>'}</div>
    </article>
  `;
}

/** הדפסה מרוכזת של כל המדבקות בחדר — נוח לפני תחילת האריזה. */
function printRoom(room) {
  const boxes = store.activeBoxes().filter((box) => box.room === room);
  if (!boxes.length) return;
  const settings = getSettings();
  // מסדרים לפי מספר עולה, כדי שהמדבקות יצאו בסדר הארגזים
  const ordered = boxes.slice().sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  label.printLabels(ordered, { sizeId: settings.labelSize, qrMode: settings.qrMode });
  toast(`${boxes.length} מדבקות נשלחו להדפסה (${LABEL_SIZES[settings.labelSize].label})`, { duration: 4000 });
}

/** רענון יזום של התצוגה. */
export function refresh() {
  render();
}
