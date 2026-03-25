// Cost Record Service Worker - Auto Update Mechanism
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

// ── Install: cache all static assets ─────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

// ── Activate: delete old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: stale-while-revalidate for HTML/JS/CSS, cache-first for others ────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and external requests
  if (event.request.method !== 'GET') return;
  if (!url.origin.includes(self.location.origin) &&
      !url.pathname.endsWith('.json') &&
      !url.pathname.endsWith('.js') &&
      !url.pathname.endsWith('.css') &&
      !url.pathname.endsWith('.html')) return;

  const isAppShell = STATIC_ASSETS.some(a => url.pathname.endsWith(a.replace('./', '/')));

  if (isAppShell) {
    // Stale-while-revalidate
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const networkFetch = fetch(event.request).then(response => {
            cache.put(event.request, response.clone());
            return response;
          });
          return cached || networkFetch;
        })
      )
    );
  }
});

// ── Message: force update ─────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
