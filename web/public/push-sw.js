/* Réception des notifications Web Push (VAPID) et ouverture de l'application au clic.
   Chargé par le service worker généré (workbox.importScripts). */
self.addEventListener('push', (event) => {
  let payload = { title: 'VTC 242', body: '', data: {} };
  try {
    payload = Object.assign(payload, event.data ? event.data.json() : {});
  } catch (e) {
    payload.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'VTC 242', {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200],
      data: payload.data || {},
      tag: (payload.data && payload.data.ride_id) || undefined,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || (data.ride_id ? '/' : '/');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
