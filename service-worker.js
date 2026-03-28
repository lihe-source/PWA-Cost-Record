// Cost Record Service Worker V4.6
// Strategy: Cache-First (instant load) + Background revalidation
// On first visit: fetch from network and cache. After that: serve from cache instantly.
// Silently updates cache in background — next open gets fresh files.

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

// ── Install: pre-cache all assets, activate immediately ──────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches, claim all clients ────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: Cache-First with background revalidation (stale-while-revalidate) ─
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  const isAppShell = STATIC_ASSETS.some(a => {
    const clean = a.replace('./', '/');
    return url.pathname === clean || url.pathname.endsWith(clean);
  }) || url.pathname === '/' || url.pathname.endsWith('/index.html');

  if (isAppShell) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          // Background revalidation
          const networkUpdate = fetch(event.request)
            .then(response => {
              if (response.ok) cache.put(event.request, response.clone());
              return response;
            })
            .catch(() => null);

          // Return cache immediately if available (instant load)
          // If no cache yet, wait for network
          return cached || networkUpdate;
        })
      )
    );
  }
});

// ── Message ───────────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
