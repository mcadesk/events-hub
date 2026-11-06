// Keeps the app shell available offline; data always comes fresh from the network.
const CACHE = 'eventshub-v30';
const PHOTOS = 'nhyiamu-photos';
async function trimPhotos(c) { const keys = await c.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - 400))) await c.delete(k); }
const SHELL = ['./', 'index.html', 'config.js?v=29', 'assets/app.css?v=29', 'assets/app.js?v=29', 'assets/sample.js?v=29', 'assets/core.js?v=29', 'assets/dash.js?v=29', 'icons/logo-mark.png', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PHOTOS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Supplier photos never change once uploaded: serve from the phone when we have them (saves data and bandwidth)
  if (e.request.method === 'GET' && url.pathname.includes('/storage/v1/object/public/listing-photos/')) {
    e.respondWith(caches.open(PHOTOS).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) { c.put(e.request, res.clone()); trimPhotos(c); }
      return res;
    }));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first, fall back to cache when offline
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
