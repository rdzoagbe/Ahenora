// Minimal service worker: exists to make the app installable. It deliberately
// caches nothing — the app ships updates continuously and a stale cache would
// hide them. The empty fetch listener leaves every request on the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
