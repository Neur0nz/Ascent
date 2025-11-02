// @deno-types="https://deno.land/x/types/web-push/index.d.ts"
import webpush from 'npm:web-push@^3.6.0';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@example.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('push: VAPID keys missing; notifications will be skipped');
}

export interface StoredPushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  encoding?: string | null;
}

export interface PushPayload {
  title: string;
  body?: string;
  tag?: string;
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
}

export type PushSendResult =
  | { delivered: true }
  | { delivered: false; reason: 'missing_vapid' | 'gone' | 'unauthorized' | 'error'; error?: unknown };

export const sendPushNotification = async (
  subscription: StoredPushSubscription,
  payload: PushPayload,
): Promise<PushSendResult> => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return { delivered: false, reason: 'missing_vapid' };
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      },
      JSON.stringify(payload),
      {
        TTL: 3600,
      },
    );
    return { delivered: true };
  } catch (error) {
    const statusCode = typeof error === 'object' && error && 'statusCode' in error ? (error as { statusCode?: number }).statusCode : null;
    if (statusCode === 404 || statusCode === 410) {
      console.warn('push: subscription endpoint expired', { endpoint: subscription.endpoint, statusCode });
      return { delivered: false, reason: 'gone' };
    }
    if (statusCode === 401 || statusCode === 403) {
      console.warn('push: unauthorized when delivering notification', { endpoint: subscription.endpoint, statusCode });
      return { delivered: false, reason: 'unauthorized', error };
    }
    console.error('push: failed to deliver notification', { endpoint: subscription.endpoint, error });
    return { delivered: false, reason: 'error', error };
  }
};
