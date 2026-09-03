// Deliberately minimal. This exists mainly so Chrome/Android will treat the site as
// installable, plus a friendly fallback if someone opens the app with no connection.
// It does NOT cache your app's JS/CSS bundles — those always come straight from the
// network, so a deploy is never masked by a stale cached version.

const CACHE_NAME = 'flh-shell-v1';
const PRECACHE_URLS = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return; // only handle page navigations — everything else goes straight to network

  event.respondWith(
    fetch(event.request).catch(() => caches.match('/offline.html'))
  );
});
