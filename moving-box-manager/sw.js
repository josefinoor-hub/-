/**
 * sw.js — Service Worker של אפליקציית ניהול הארגזים.
 *
 * מטרה: שהאפליקציה תיפתח ותעבוד במלואה גם בלי רשת (מחסן, מרתף, מעלית).
 * קבצי האפליקציה נשמרים במטמון; בקשות לשרת הסנכרון לעולם אינן נשמרות,
 * כדי שלא יוצגו נתונים ישנים במקום תשובה אמיתית.
 */

const CACHE_NAME = 'moving-box-manager-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/api.js',
  './js/boxes.js',
  './js/config.js',
  './js/db.js',
  './js/dialogs.js',
  './js/export.js',
  './js/label.js',
  './js/numbers.js',
  './js/qr.js',
  './js/scanner.js',
  './js/settings.js',
  './js/store.js',
  './js/sync.js',
  './js/thermal.js',
  './js/ui.js',
  './js/util.js',
  './js/views/boxDetail.js',
  './js/views/boxForm.js',
  './js/views/scan.js',
  './js/views/settings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // בקשות לשרת הסנכרון (מקור אחר) עוברות ישירות לרשת, ללא מטמון
  if (url.origin !== self.location.origin) return;

  // ניווט: קודם רשת (כדי לקבל גרסה עדכנית), ובנפילה — הדף מהמטמון
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true }))
    );
    return;
  }

  // נכסי האפליקציה: מהמטמון מיד, ועדכון ברקע לפעם הבאה
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

/** רענון מיידי כשגרסה חדשה מחכה. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
