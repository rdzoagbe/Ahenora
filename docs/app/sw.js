// Minimal service worker: exists to make the app installable and to receive Web
// Push. It deliberately caches nothing — the app ships updates continuously and
// a stale cache would hide them. The empty fetch listener leaves every request
// on the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// A push arrived (even with the tab closed) — show it as a system notification.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = {}; }
  const title = payload.title || 'Ahenora';
  const options = {
    body: payload.body || '',
    icon: '/app/icon-192.png',
    badge: '/app/icon-192.png',
    data: payload.data || {},
    tag: (payload.data && payload.data.type) || undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification focuses an open Ahenora tab (or opens one) and hands
// it the payload so the app can route to the right screen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (client.url.includes('/app') && 'focus' in client) {
        client.postMessage({ type: 'push-notification-tap', data });
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow('/app/feed');
  })());
});
