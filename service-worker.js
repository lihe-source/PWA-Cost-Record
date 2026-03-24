importScripts('./version.js');
const STATIC_ASSETS = ['./', './index.html', './styles.css', './app.js', './version.js', './manifest.json'];
self.addEventListener('install', event => { self.skipWaiting(); event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!url.origin.includes(self.location.origin) && !url.pathname.match(/\.(json|js|css|html)$/)) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(res => { return caches.open(CACHE_NAME).then(c => { c.put(event.request, res.clone()); return res; }); })));
});
self.addEventListener('message', event => { if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting(); });
