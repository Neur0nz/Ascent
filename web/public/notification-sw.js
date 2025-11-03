/* eslint-disable no-restricted-globals */
const FOCUSABLE_CLIENT_TYPES = ['window'];
const clientMatchState = new Map();

const normalizeMatchId = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') {
    return;
  }
  if (data.type !== 'santorini:match-visibility') {
    return;
  }
  const source = event.source;
  if (!source || typeof source.id !== 'string') {
    return;
  }

  const matchId = normalizeMatchId(data.matchId);
  const visible = Boolean(data.visible);
  const timestamp =
    typeof data.timestamp === 'number' && Number.isFinite(data.timestamp) ? data.timestamp : Date.now();

  if (!matchId) {
    clientMatchState.delete(source.id);
    return;
  }

  clientMatchState.set(source.id, { matchId, visible, timestamp });
});

const shouldSuppressNotification = async (matchId) => {
  if (!matchId) {
    return false;
  }
  const allClients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  const activeIds = new Set(allClients.map((client) => client.id));
  for (const knownId of Array.from(clientMatchState.keys())) {
    if (!activeIds.has(knownId)) {
      clientMatchState.delete(knownId);
    }
  }

  for (const client of allClients) {
    const state = clientMatchState.get(client.id);
    if (!state) {
      continue;
    }
    if (state.matchId !== matchId) {
      continue;
    }
    const visibilityState = typeof client.visibilityState === 'string' ? client.visibilityState : undefined;
    const clientFocused = typeof client.focused === 'boolean' ? client.focused : undefined;
    const messageVisible = state.visible === true;

    const isClientVisible = visibilityState === 'visible' || visibilityState === undefined;
    const isFocusedOrUnknown = clientFocused !== false;

    if (messageVisible && isFocusedOrUnknown) {
      return true;
    }

    if (visibilityState === 'hidden') {
      continue;
    }

    if (isClientVisible && isFocusedOrUnknown) {
      return true;
    }
  }
  return false;
};

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

  event.waitUntil(
    (async () => {
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

      const matchId = normalizeMatchId(options.data?.matchId);
      const suppress = await shouldSuppressNotification(matchId);
      if (!suppress) {
        await self.registration.showNotification(title, options);
      }
    })(),
  );
});
