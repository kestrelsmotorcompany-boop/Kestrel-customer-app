
const CACHE = 'my-kestrels-v8';
const ASSETS = ['./styles.css', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('/api/') || event.request.url.includes('/app.js')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' })); 
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(event.request).then(response =>
        response || fetch(event.request)
      )
    )
  );
});
