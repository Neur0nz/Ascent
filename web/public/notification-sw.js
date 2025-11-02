/* eslint-disable no-restricted-globals */
const FOCUSABLE_CLIENT_TYPES = ['window'];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const focusUrl = notification?.data?.focusUrl;
  notification.close();

  if (!focusUrl) {
    return;
  }

  event.waitUntil(
    (async () => {
      const url = new URL(focusUrl, self.location.origin).href;
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of allClients) {
        if (!FOCUSABLE_CLIENT_TYPES.includes(client.type)) {
          continue;
        }
        const clientUrl = client.url;
        if (!clientUrl) {
          continue;
        }
        const isSamePage =
          clientUrl === url ||
          clientUrl.replace(/\/+$/, '') === url.replace(/\/+$/, '') ||
          clientUrl.startsWith(`${url}#`) ||
          clientUrl.startsWith(`${url}?`);
        if (isSamePage && 'focus' in client) {
          await client.focus();
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })(),
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  let payload = {};
  try {
    payload = event.data.json();
  } catch (_error) {
    payload = { title: 'Santorini', body: event.data.text() };
  }

  const title = payload.title ?? 'Santorini';
  const options = {
    body: payload.body ?? '',
    tag: payload.tag,
    data: payload.data ?? {},
    requireInteraction: Boolean(payload.requireInteraction),
    renotify: Boolean(payload.renotify),
    icon: payload.icon,
    badge: payload.badge,
    vibrate: payload.vibrate ?? [100, 50, 100],
    actions: payload.actions ?? undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
