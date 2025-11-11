// @deno-types="https://deno.land/x/types/web-push/index.d.ts"
import webpush from 'npm:web-push@^3.6.0';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@example.com';
const MAX_PUSH_PAYLOAD_BYTES = 2048;
const payloadEncoder = new TextEncoder();

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

const serializePayload = (payload: PushPayload): string => {
  const measure = (body: PushPayload) => payloadEncoder.encode(JSON.stringify(body)).length;
  let workingPayload: PushPayload = { ...payload };
  let byteLength = measure(workingPayload);

  if (byteLength <= MAX_PUSH_PAYLOAD_BYTES) {
    return JSON.stringify(workingPayload);
  }

  if (typeof workingPayload.body === 'string' && workingPayload.body.length > 0) {
    const original = workingPayload.body;
    let trimmedLength = original.length;
    while (trimmedLength > 0) {
      trimmedLength -= 1;
      const nextBody = `${original.slice(0, trimmedLength)}…`;
      const candidate: PushPayload = { ...workingPayload, body: nextBody };
      byteLength = measure(candidate);
      if (byteLength <= MAX_PUSH_PAYLOAD_BYTES) {
        console.warn('push: truncated notification body to satisfy payload limit', {
          originalLength: original.length,
          truncatedLength: nextBody.length,
        });
        return JSON.stringify(candidate);
      }
    }
  }

  if (workingPayload.data) {
    const { data, ...rest } = workingPayload;
    byteLength = measure(rest);
    if (byteLength <= MAX_PUSH_PAYLOAD_BYTES) {
      console.warn('push: removed payload data to satisfy payload limit', {
        removedKeys: Object.keys(data ?? {}),
      });
      return JSON.stringify(rest);
    }
    workingPayload = rest;
  }

  const fallbackPayload: PushPayload = {
    title: payload.title ?? 'Santorini',
    body: 'Open Santorini to rejoin your match.',
    tag: payload.tag,
  };
  const fallbackSerialized = JSON.stringify(fallbackPayload);
  if (measure(fallbackPayload) <= MAX_PUSH_PAYLOAD_BYTES) {
    console.warn('push: payload exceeded limit; sending minimal fallback payload');
    return fallbackSerialized;
  }

  throw new Error('push_payload_too_large');
};

export const sendPushNotification = async (
  subscription: StoredPushSubscription,
  payload: PushPayload,
): Promise<PushSendResult> => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return { delivered: false, reason: 'missing_vapid' };
  }

  let serializedPayload: string;
  try {
    serializedPayload = serializePayload(payload);
  } catch (error) {
    console.error('push: payload serialization failed', { error });
    return { delivered: false, reason: 'error', error };
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
      serializedPayload,
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

const delay = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

export const sendPushNotificationWithRetry = async (
  subscription: StoredPushSubscription,
  payload: PushPayload,
  maxRetries = 3,
): Promise<PushSendResult> => {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const result = await sendPushNotification(subscription, payload);
    if (result.delivered || result.reason === 'gone' || result.reason === 'unauthorized') {
      return result;
    }
    if (attempt < maxRetries - 1) {
      const delayMs = 1000 * 2 ** attempt;
      await delay(delayMs);
    }
  }
  return { delivered: false, reason: 'error', error: 'Max retries exceeded' };
};
