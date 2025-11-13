import { supabase } from '@/lib/supabaseClient';
import type { PlayerProfile } from '@/types/match';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
const SUBSCRIPTION_REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 7; // renew a week before expiry

const base64UrlToUint8Array = (base64Url: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  if (typeof atob !== 'function') {
    throw new Error('pushNotifications: atob is not available in this environment');
  }
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

const getServiceWorkerRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    return await navigator.serviceWorker.ready;
  } catch (error) {
    console.warn('pushNotifications: service worker not ready', error);
    return null;
  }
};

export const pushSupported = (): boolean => {
  return (
    typeof window !== 'undefined'
    && 'Notification' in window
    && typeof Notification !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
  );
};

interface SyncOptions {
  permission: NotificationPermission | 'unsupported';
  profile: PlayerProfile | null;
}

const deleteStoredSubscription = async (endpoint: string, authUserId?: string | null) => {
  if (!authUserId) {
    return;
  }
  const supabaseClient = supabase;
  if (!supabaseClient) {
    console.warn('pushNotifications: Supabase client unavailable; skipping subscription cleanup');
    return;
  }
  const { error } = await supabaseClient
    .from('web_push_subscriptions')
    .delete()
    .eq('auth_user_id', authUserId)
    .eq('endpoint', endpoint);
  if (error) {
    console.warn('pushNotifications: failed to remove subscription from database', error);
  }
};

export const removePushSubscription = async (profile: PlayerProfile | null): Promise<void> => {
  if (!pushSupported()) {
    return;
  }
  const registration = await getServiceWorkerRegistration();
  const existing = await registration?.pushManager.getSubscription();
  if (!existing) {
    return;
  }
  try {
    await existing.unsubscribe();
  } catch (error) {
    console.warn('pushNotifications: failed to unsubscribe push manager', error);
  }
  await deleteStoredSubscription(existing.endpoint, profile?.auth_user_id ?? null);
};

export const syncPushSubscription = async ({ permission, profile }: SyncOptions): Promise<void> => {
  const supabaseClient = supabase;

  if (permission !== 'granted') {
    if (permission !== 'denied') {
      return;
    }
    if (!pushSupported()) {
      return;
    }
    const registration = await getServiceWorkerRegistration();
    const existing = await registration?.pushManager.getSubscription();
    if (existing) {
      await removePushSubscription(profile ?? null);
    }
    return;
  }

  if (!profile || !profile.auth_user_id) {
    return;
  }

  if (!pushSupported()) {
    console.warn('pushNotifications: browser does not support Push API');
    return;
  }

  if (!VAPID_PUBLIC_KEY) {
    console.warn('pushNotifications: missing VITE_VAPID_PUBLIC_KEY environment variable');
    return;
  }

  const registration = await getServiceWorkerRegistration();
  if (!registration) {
    console.warn('pushNotifications: service worker registration unavailable');
    return;
  }

  let subscription = await registration.pushManager.getSubscription();
  const expiresSoon = (() => {
    if (!subscription?.expirationTime) {
      return false;
    }
    return subscription.expirationTime - Date.now() < SUBSCRIPTION_REFRESH_THRESHOLD_MS;
  })();
  if (subscription && expiresSoon) {
    try {
      await subscription.unsubscribe();
    } catch (error) {
      console.warn('pushNotifications: failed to renew expiring subscription', error);
    }
    subscription = null;
  }
  if (!subscription) {
    try {
      const vapidKey = base64UrlToUint8Array(VAPID_PUBLIC_KEY);
      const applicationServerKey = vapidKey.buffer as ArrayBuffer;
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    } catch (error) {
      console.error('pushNotifications: failed to subscribe to push manager', error);
      return;
    }
  }

  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const authKey = json.keys?.auth;
  const p256dhKey = json.keys?.p256dh;

  if (!endpoint || !authKey || !p256dhKey) {
    console.warn('pushNotifications: subscription missing keys');
    return;
  }

  if (!supabaseClient) {
    console.warn('pushNotifications: Supabase client unavailable; skipping subscription persistence');
    return;
  }

  const { error } = await supabaseClient.functions.invoke('sync-push-subscription', {
    body: {
      endpoint,
      keys: {
        auth: authKey,
        p256dh: p256dhKey,
      },
      encoding: json.keys?.encoding ?? 'aesgcm',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    },
  });

  if (error) {
    console.error('pushNotifications: failed to persist subscription', error);
  }
};
