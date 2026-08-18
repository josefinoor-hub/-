/**
 * views/boxForm.js — טופס הוספה ועריכה של ארגז.
 *
 * הטופס מותאם לאריזה בפועל: בחירת חדר בהקשה אחת, הקלדת תכולה חופשית,
 * ושמירה שממשיכה ישר לארגז הבא — כדי לא לעצור את קצב העבודה.
 */

import { ROOMS, PRIORITY } from '../config.js';
import { createBox, roomInfo, updateBox } from '../boxes.js';
import * as store from '../store.js';
import * as numbers from '../numbers.js';
import { getSettings } from '../settings.js';
import { openModal, close as closeModal, toast } from '../dialogs.js';
import { el, splitItems, escapeHtml } from '../util.js';

/** החדר האחרון שנבחר — נשמר בין ארגזים כדי לחסוך הקשות. */
let lastRoom = ROOMS[0].name;

/**
 * @param {{box?: object, onSaved?: (box: object) => void}} options
 */
export function openBoxForm({ box = null, onSaved } = {}) {
  const isEdit = Boolean(box);
  const form = el('form', { class: 'box-form', autocomplete: 'off' });
  let selectedRoom = box?.room || lastRoom;

  // --- בחירת חדר ---
  const roomGrid = el('div', { class: 'room-grid', role: 'radiogroup', 'aria-label': 'בחירת חדר' });
  const roomButtons = new Map();
  for (const room of ROOMS) {
    const button = el('button', {
      type: 'button',
      class: 'room-chip',
      dataset: { room: room.name },
      style: `--room-color: ${room.color}`,
      'aria-pressed': String(room.name === selectedRoom),
      onclick: () => selectRoom(room.name),
    }, [
      el('span', { class: 'room-chip__icon' }, [room.icon]),
      el('span', { class: 'room-chip__name' }, [room.name]),
    ]);
    roomButtons.set(room.name, button);
    roomGrid.append(button);
  }

  function selectRoom(name) {
    selectedRoom = name;
    for (const [roomName, button] of roomButtons) {
      button.setAttribute('aria-pressed', String(roomName === name));
    }
  }

  // --- תכולה ---
  const itemsField = el('textarea', {
    class: 'input input--textarea',
    name: 'items',
    rows: '3',
    placeholder: 'למשל: ספרים, מנורת שולחן, אלבומים',
    'aria-label': 'פירוט תכולה',
  });
  itemsField.value = (box?.items || []).join(', ');

  const itemsPreview = el('div', { class: 'item-chips', 'aria-live': 'polite' });
  const renderItems = () => {
    const items = splitItems(itemsField.value);
    itemsPreview.innerHTML = items.length
      ? items.map((item) => `<span class="item-chip">${escapeHtml(item)}</span>`).join('')
      : '<span class="hint">הפרידו פריטים בפסיק או בשורה חדשה</span>';
  };
  itemsField.addEventListener('input', renderItems);
  renderItems();

  // --- סימונים ---
  const fragileToggle = createToggle('שביר — לטפל בזהירות', '⚠️', box?.fragile ?? false);
  const priorityToggle = createToggle(
    'עדיפות פריקה גבוהה',
    '★',
    (box?.priority ?? PRIORITY.NORMAL) === PRIORITY.HIGH
  );

  const notesField = el('input', {
    class: 'input',
    name: 'notes',
    type: 'text',
    placeholder: 'הערה (לא חובה)',
    'aria-label': 'הערה',
  });
  notesField.value = box?.notes || '';

  form.append(
    field('חדר / קטגוריה', roomGrid),
    field('תכולת הארגז', el('div', {}, [itemsField, itemsPreview])),
    field('סימון מיוחד', el('div', { class: 'toggle-row' }, [fragileToggle.element, priorityToggle.element])),
    field('הערות', notesField)
  );

  const saveAndNew = !isEdit
    ? { label: 'שמירה והוספת עוד', variant: 'ghost', onClick: () => submit({ keepOpen: true }) }
    : null;

  const dialog = openModal({
    title: isEdit ? `עריכת ${box.boxNumber || 'ארגז'}` : 'הוספת ארגז חדש',
    body: form,
    size: 'lg',
    actions: [
      saveAndNew,
      { label: isEdit ? 'שמירת שינויים' : 'שמירה', variant: 'primary', onClick: () => submit({ keepOpen: false }) },
    ].filter(Boolean),
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit({ keepOpen: false });
  });

  async function submit({ keepOpen }) {
    const items = splitItems(itemsField.value);
    if (!items.length && !notesField.value.trim()) {
      toast('הוסיפו לפחות פריט אחד או הערה', { type: 'error' });
      itemsField.focus();
      return;
    }

    const settings = getSettings();
    let saved;

    if (isEdit) {
      saved = await store.saveLocal(
        updateBox(
          box,
          {
            room: selectedRoom,
            items,
            fragile: fragileToggle.checked(),
            priority: priorityToggle.checked() ? PRIORITY.HIGH : PRIORITY.NORMAL,
            notes: notesField.value,
          },
          settings.deviceName
        )
      );
      toast(`${saved.boxNumber || 'הארגז'} עודכן`, { type: 'success' });
    } else {
      const number = await numbers.allocate();
      saved = await store.saveLocal(
        createBox({
          room: selectedRoom,
          items,
          fragile: fragileToggle.checked(),
          priority: priorityToggle.checked() ? PRIORITY.HIGH : PRIORITY.NORMAL,
          notes: notesField.value,
          number,
          device: settings.deviceName,
        })
      );
      lastRoom = selectedRoom;
      toast(
        saved.boxNumber
          ? `${saved.boxNumber} נוסף ל${roomInfo(selectedRoom).name}`
          : 'הארגז נשמר. מספר הארגז ישובץ עם החיבור הבא לרשת',
        { type: 'success' }
      );
    }

    if (keepOpen) {
      itemsField.value = '';
      notesField.value = '';
      fragileToggle.set(false);
      priorityToggle.set(false);
      renderItems();
      itemsField.focus();
      onSaved?.(saved, { keepOpen: true });
      return;
    }

    closeModal();
    onSaved?.(saved, { keepOpen: false });
  }

  return dialog;
}

function field(labelText, control) {
  return el('label', { class: 'field' }, [el('span', { class: 'field__label' }, [labelText]), control]);
}

function createToggle(labelText, icon, initial) {
  const input = el('input', { type: 'checkbox', class: 'toggle__input' });
  input.checked = Boolean(initial);
  const element = el('label', { class: 'toggle' }, [
    input,
    el('span', { class: 'toggle__icon' }, [icon]),
    el('span', { class: 'toggle__label' }, [labelText]),
  ]);
  return {
    element,
    checked: () => input.checked,
    set: (value) => {
      input.checked = value;
    },
  };
}
