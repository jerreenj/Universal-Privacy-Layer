/* eslint-disable no-restricted-globals */

const CACHE_NAME = 'upl-cache-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/static/js/main.js',
  '/static/css/main.css'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.log('[SW] Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - cache-first for static assets, network-first for HTML
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip API calls - always fetch from network
  if (event.request.url.includes('/api/')) {
    return;
  }

  // Skip external resources
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  const url = new URL(event.request.url);
  const isStaticAsset =
    /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico|json|wasm)$/.test(url.pathname);

  // Navigation requests (HTML pages): network-first so users always get
  // the latest markup, falling back to cache when offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // Static assets: cache-first for instant repeat loads. Revalidate in the
  // background so the cache stays fresh without blocking the response.
  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((response) => {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
            return response;
          })
          .catch(() => cachedResponse);
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // Everything else: network-first, fallback to cache.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cachedResponse) => cachedResponse || new Response('Offline', { status: 503 }))
      )
  );
});

// Handle push notifications
self.addEventListener('push', (event) => {
  const options = {
    body: event.data?.text() || 'New privacy transaction update',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      { action: 'view', title: 'View' },
      { action: 'close', title: 'Close' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('UPL Privacy Layer', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Background sync for offline transactions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-transactions') {
    event.waitUntil(syncPendingTransactions());
  }
});

async function syncPendingTransactions() {
  const cache = await caches.open('upl-pending-tx');
  const requests = await cache.keys();
  
  for (const request of requests) {
    try {
      const response = await fetch(request.clone());
      if (response.ok) {
        await cache.delete(request);
      }
    } catch (err) {
      console.log('[SW] Sync failed for:', request.url);
    }
  }
}
