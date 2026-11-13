// Service worker: lets the app open with no internet.
// Strategy: try the network first (so you always get the newest version),
// fall back to the saved copy when offline.
const CACHE = 'lifedash-v14';
const APP_FILES = [
  './', './index.html', './styles.css', './pixels.js', './pdf-import.js', './push.js', './app.js', './ai.js', './vendor/anthropic-sdk.mjs',
  './manifest.webmanifest',
  './fonts/fraunces.woff2', './fonts/dm-sans.woff2',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/badge-96.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    // cache: 'no-cache' = always ask the server for the newest file, so the phone
    // never mixes an old page with new code (that's what broke the icons).
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});

// ---------- Reminder notifications (sent by push-server/) ----------

self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(msg.title || 'Life Dashboard', {
    body: msg.body || '',
    tag: msg.tag || undefined,          // same tag replaces instead of stacking
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',      // small white icon in the status bar
    data: { view: String(msg.tag || '').startsWith('w:') ? 'money' : 'tasks' }, // weekly recap opens Money
  }));
});

// Tapping a notification opens the app (or brings it to the front)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const view = event.notification.data?.view || 'tasks';
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { w.postMessage({ type: 'open-view', view }); return w.focus(); }
    }
    return self.clients.openWindow(`./#${view}`);
  })());
});
