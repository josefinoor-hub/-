// ============================================
// Service Worker - Fermentation Calculator PWA
// ============================================

const CACHE_NAME = 'fermentation-calc-v1';
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/fermentation_calculator.html',
  '/manifest.json'
];

// ============================================
// Installation
// ============================================
self.addEventListener('install', event => {
  console.log('🔧 Service Worker מתקין...');
  
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('💾 שמירת קבצים ל-cache');
      return cache.addAll(FILES_TO_CACHE).catch(err => {
        console.log('⚠️ כמה קבצים לא נמצאו:', err);
        // אל תכשל אם קבצים מסוימים לא זמינים
        return cache.add('/fermentation_calculator.html');
      });
    })
  );
  
  self.skipWaiting();
});

// ============================================
// Activation
// ============================================
self.addEventListener('activate', event => {
  console.log('🚀 Service Worker מופעל');
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ מחיקת cache ישן:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  
  self.clients.claim();
});

// ============================================
// Fetch - Network First, Cache Fallback
// ============================================
self.addEventListener('fetch', event => {
  // אל תמטפל בדברים שאינם GET
  if (event.request.method !== 'GET') {
    return;
  }

  // אם זה תמונה או קובץ חיצוני, השתמש ב-cache first
  if (event.request.url.includes('cdn') || event.request.destination === 'image') {
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
        .catch(() => new Response('אין חיבור לרשת'))
    );
    return;
  }

  // ברירת מחדל: Network First, Cache Fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // אם התגובה בסדר, שמור ב-cache
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // אם אין רשת, נסה cache
        return caches.match(event.request)
          .then(response => response || new Response('עמוד לא נמצא בחוץ קו'));
      })
  );
});

// ============================================
// Background Sync (עדכונים)
// ============================================
self.addEventListener('sync', event => {
  if (event.tag === 'sync-cals') {
    event.waitUntil(
      // כאן אפשר להוסיף לוגיקה לסינכרון קליברציות
      Promise.resolve()
    );
  }
});

// ============================================
// Periodic Background Sync (אופציונלי)
// ============================================
self.addEventListener('periodicsync', event => {
  if (event.tag === 'update-cache') {
    event.waitUntil(
      fetch('/fermentation_calculator.html')
        .then(response => {
          if (response && response.status === 200) {
            return caches.open(CACHE_NAME).then(cache => {
              return cache.put('/fermentation_calculator.html', response);
            });
          }
        })
        .catch(() => {})
    );
  }
});

console.log('✅ Service Worker טעון ומוכן');
