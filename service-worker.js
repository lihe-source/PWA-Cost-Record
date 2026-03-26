// Cost Record Service Worker V2.5
// Strategy: Network-First for all app shell files
// This ensures GitHub Pages updates are always picked up immediately

importScripts('./version.js');

const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './version.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ── Install: pre-cache all assets, skip waiting immediately ──────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())   // activate new SW right away
  );
});

// ── Activate: purge all old caches, claim clients immediately ────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())  // take over all open tabs now
  );
});

// ── Fetch: Network-First for all same-origin requests ────────────────────────
// Falls back to cache only when fully offline
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle GET requests to our own origin
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then(response => {
        // Cache the fresh response for offline fallback
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline: serve from cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Last resort for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});

// ── Message: skip waiting on demand ──────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
