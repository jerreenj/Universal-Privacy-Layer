/* eslint-disable no-restricted-globals */
/* eslint-disable no-undef */

// Universal Privacy Layer — service worker.
//
// v2 (2026-07-04) — full network-first, no caching.
//
// History:
//   v1 — cache-first for chunks. This caused the "blank page after deploy"
//        bug because users who had visited an earlier build kept getting
//        stale chunks (cache hit) that referenced components whose lazy
//        chunks had been rebuilt under different hashes. The lazy-import
//        dispatcher would then silently fail, leaving Suspense fallback
//        visible forever (looks blank).
//   v2 — network-first for EVERY asset, no cache. We bumped CACHE_NAME
//        from `upl-cache-v1` to `upl-cache-v2` so on `activate` the SW
//        automatically calls `caches.delete()` on every prior cache name.
//        Going forward, browsers fetch the live bundle on every page
//        load. The cost is ~50ms of repeat-visit latency; the
//        benefit is users ALWAYS see what is actually deployed.

const CACHE_NAME = 'upl-cache-v2';
const VERSION_TAG = 'v2-2026-07-04-no-cache';

self.addEventListener('install', (event) => {
  // Activate immediately; no static asset pre-cache.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // 1. Wipe every existing cache (incl. v1, ad-hoc test caches) so
      //    no stale chunk can survive an upgrade of this SW file. The
      //    filter keeps only caches whose name equals CACHE_NAME; right
      //    now that's nothing (we don't cache anything in v2) but the
      //    pattern is still correct for any future cache we add.
      caches.keys().then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      ),
      // 2. Take control of all open clients immediately so the new fetch
      //    policy takes effect without requiring a reload of the page.
      self.clients.claim(),
    ]).then(() =>
      // 3. Notify every page that a new SW is in charge (the page can
      //    show a "cache refreshed" toast if it wants).
      self.clients.matchAll({ type: 'window' }).then((cs) =>
        cs.forEach((c) => c.postMessage({ type: 'sw-activated', version: VERSION_TAG }))
      )
    )
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET; mutations (POST/PUT/DELETE) bypass any SW logic.
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never touch API traffic — it must always be live.
  if (url.pathname.startsWith('/api/')) return;

  // Never proxy cross-origin requests (Google Fonts, explorer images…).
  if (url.origin !== self.location.origin) return;

  // Network-first for **everything**, always. We do not read from
  // `caches` for any URL. Users always get the version that's running
  // on the server right now. If the network is gone, return a real 503
  // (instead of a stale 200) so callers can detect "no network" rather
  // than seeing a blank page that pretends to be the current site.
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          JSON.stringify({
            error: 'offline',
            message:
              'Service Worker v2: no cache fallback. Check your connection.',
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }
        )
    )
  );
});

// Allow the page to ask the new SW to skipWaiting immediately after a
// deploy. (Currently unused, but harmless to ship.)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Push notifications — keep these as-is so users who subscribed to
// background updates still get them. They don't touch the cache bug.
self.addEventListener('push', (event) => {
  const options = {
    body: event.data?.text() || 'New privacy transaction update',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: { dateOfArrival: Date.now(), primaryKey: 1 },
    actions: [
      { action: 'view', title: 'View' },
      { action: 'close', title: 'Close' },
    ],
  };
  event.waitUntil(self.registration.showNotification('UPL Privacy Layer', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'view') event.waitUntil(clients.openWindow('/'));
});
