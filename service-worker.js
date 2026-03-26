// Cost Record Service Worker V2.3 - Auto Update Mechanism
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
  // Do NOT skipWaiting here — let the update banner trigger it
  // so the user can choose when to reload
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

// ── Activate: delete old caches & immediately take control ───────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for version.js so new versions are always detected ──
//          stale-while-revalidate for other app shell files
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  const pathname = url.pathname;

  // version.js: always network-first — must bypass cache to detect new deployments
  if (pathname.endsWith('version.js')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell: stale-while-revalidate
  const isAppShell = STATIC_ASSETS.some(a => {
    const clean = a.replace('./', '/');
    return pathname === clean || pathname.endsWith(clean);
  });

  if (isAppShell) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const networkFetch = fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => null);
          return cached || networkFetch;
        })
      )
    );
  }
});

// ── Message: SKIP_WAITING triggered by user tapping the update banner ─────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
