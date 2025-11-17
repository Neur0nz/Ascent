/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, PrecacheEntry } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & typeof globalThis & {
  __WB_MANIFEST: Array<PrecacheEntry>;
};

declare global {
  interface NotificationAction {
    action: string;
    title: string;
    icon?: string;
  }

  interface NotificationOptions {
    renotify?: boolean;
    vibrate?: number[];
    actions?: NotificationAction[];
  }
}

const FOCUSABLE_CLIENT_TYPES = ['window'];
const PUSH_SUBSCRIPTION_CHANGED_EVENT = 'santorini:push-subscription-changed';
const clientMatchState = new Map<string, { matchId: string; visible: boolean; focused: boolean; timestamp: number }>();

const resolveAssetUrl = (path: string): string => {
  const normalized = path.startsWith('/') ? path.slice(1) : path;
  const base = self.registration?.scope ?? self.location.origin;
  return new URL(normalized, base).href;
};

const DEFAULT_NOTIFICATION_ICON = resolveAssetUrl('icons/notification-icon.png');
const DEFAULT_NOTIFICATION_BADGE = resolveAssetUrl('icons/notification-badge.png');

const normalizeMatchId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object');
};

const isClientSource = (value: unknown): value is Client => {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      typeof (value as Client).id === 'string' &&
      typeof (value as Client).type === 'string',
  );
};

type ServiceWorkerMessageSource = MessagePort | ServiceWorker | Client;

const getSourceId = (source: ServiceWorkerMessageSource | null | undefined): string | null => {
  if (!isClientSource(source)) {
    return null;
  }
  return source.id;
};

clientsClaim();
self.skipWaiting();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data;
  if (!isRecord(data)) {
    return;
  }
  if (data.type !== 'santorini:match-visibility') {
    return;
  }
  const sourceId = getSourceId(event.source);
  if (!sourceId) {
    return;
  }

  const matchId = normalizeMatchId(data.matchId);
  const visible = Boolean(data.visible);
  const focused = Boolean(data.focused);
  const timestamp =
    typeof data.timestamp === 'number' && Number.isFinite(data.timestamp) ? data.timestamp : Date.now();

  if (!matchId) {
    clientMatchState.delete(sourceId);
    return;
  }

  clientMatchState.set(sourceId, { matchId, visible, focused, timestamp });
});

const shouldSuppressNotification = async (matchId: string | null): Promise<boolean> => {
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
    if (!state || state.matchId !== matchId) {
      continue;
    }
    const windowClient = client as WindowClient;
    const visibilityState =
      typeof windowClient.visibilityState === 'string' ? windowClient.visibilityState : undefined;
    const isClientVisible = visibilityState === 'visible' || visibilityState === undefined;
    if (!isClientVisible) {
      continue;
    }
    const clientFocused = typeof windowClient.focused === 'boolean' ? windowClient.focused : true;
    if (state.visible && state.focused && clientFocused) {
      return true;
    }
  }
  return false;
};

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  const notification = event.notification;
  const notificationData = isRecord(notification?.data) ? notification.data : {};
  notification.close();

  const scopeBase = self.registration?.scope ?? self.location.origin;
  const focusUrl = typeof notificationData.focusUrl === 'string' ? notificationData.focusUrl : null;
  const url = focusUrl ? new URL(focusUrl, scopeBase).href : scopeBase;

  event.waitUntil(
    (async () => {
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
        const normalizedClientUrl = clientUrl.replace(/\/+$/, '');
        const normalizedUrl = url.replace(/\/+$/, '');
        const isSamePage =
          clientUrl === url ||
          normalizedClientUrl === normalizedUrl ||
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

self.addEventListener('push', (event: PushEvent) => {
  const pushData = event.data;
  if (!pushData) {
    return;
  }

  event.waitUntil(
    (async () => {
      let payloadData: Record<string, unknown> = {};
      try {
        payloadData = pushData.json();
      } catch (error) {
        payloadData = {
          title: 'Santorini',
          body: typeof pushData.text === 'function' ? pushData.text() : '',
        };
        console.warn('service-worker: failed to parse push payload as JSON', error);
      }

      const title =
        typeof payloadData.title === 'string' && payloadData.title.length > 0 ? payloadData.title : 'Santorini';
      const body = typeof payloadData.body === 'string' ? payloadData.body : '';
      const tag = typeof payloadData.tag === 'string' ? payloadData.tag : undefined;
      const data = isRecord(payloadData.data) ? payloadData.data : undefined;
      const icon = typeof payloadData.icon === 'string' && payloadData.icon.length > 0
        ? payloadData.icon
        : DEFAULT_NOTIFICATION_ICON;
      const badge = typeof payloadData.badge === 'string' && payloadData.badge.length > 0
        ? payloadData.badge
        : DEFAULT_NOTIFICATION_BADGE;
      const vibrate =
        Array.isArray(payloadData.vibrate) && payloadData.vibrate.every((value) => typeof value === 'number')
          ? (payloadData.vibrate as number[])
          : undefined;
      const actions = Array.isArray(payloadData.actions)
        ? (payloadData.actions as NotificationOptions['actions'])
        : undefined;

      const options: NotificationOptions & {
        data?: Record<string, unknown>;
        renotify?: boolean;
        vibrate?: number[];
      } = {
        body,
        tag,
        data,
        requireInteraction: Boolean(payloadData.requireInteraction),
        renotify: Boolean(payloadData.renotify),
        icon,
        badge,
        vibrate: vibrate ?? [100, 50, 100],
        actions,
      };

      const matchId = normalizeMatchId(options.data?.matchId);
      const suppress = await shouldSuppressNotification(matchId);
      if (!suppress) {
        await self.registration.showNotification(title, options);
      }
    })(),
  );
});

self.addEventListener('pushsubscriptionchange', (event: PushSubscriptionChangeEvent) => {
  event.waitUntil(
    (async () => {
      const applicationServerKey = event.oldSubscription?.options?.applicationServerKey ?? null;
      if (!event.newSubscription && applicationServerKey) {
        try {
          await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          });
        } catch (error) {
          console.warn('service-worker: failed to resubscribe after push change', error);
        }
      }
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of clients) {
        try {
          client.postMessage({ type: PUSH_SUBSCRIPTION_CHANGED_EVENT });
        } catch (error) {
          console.warn('service-worker: failed to notify client about push subscription change', error);
        }
      }
    })(),
  );
});
