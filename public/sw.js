// public/sw.js — the service worker. It exists for exactly one reason: a web
// push cannot be delivered without one.
//
// DELIBERATELY NOT A CACHE. A service worker that caches is a service worker
// that can serve a stale scoreboard, and a stale scoreboard is worse than a
// slow one. This handles two events and nothing else.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* malformed payload */ }
  const title = data.title || 'Sportsvyn';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    // THE TAG REPLACES RATHER THAN STACKS. Twelve score alerts for one game is
    // a notification centre nobody reads; the newest is the scoreboard.
    tag: data.tag || 'sportsvyn',
    renotify: true,
    data: { url: data.url || '/' },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  // FOCUS AN OPEN TAB RATHER THAN OPENING A SECOND ONE. A reader tapping three
  // score alerts should end with one Sportsvyn tab, not three.
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes(url) && 'focus' in c) return c.focus();
    }
    for (const c of all) {
      if ('navigate' in c && 'focus' in c) { await c.navigate(url); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
