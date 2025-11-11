import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import { sendPushNotificationWithRetry, type StoredPushSubscription } from '../_shared/push.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? null;
const MATCH_PING_COOLDOWN_MS = 60_000;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase configuration environment variables');
}

interface PingOpponentRequest {
  matchId?: string;
}

interface PlayerProfile {
  id: string;
  display_name: string | null;
}

interface MatchRecord {
  id: string;
  status: string;
  creator_id: string;
  opponent_id: string | null;
  creator?: PlayerProfile | null;
  opponent?: PlayerProfile | null;
}

type ServiceSupabaseClient = SupabaseClient<any, any, any>;

function jsonResponse(body: Record<string, unknown>, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    ...init,
  });
}

const sanitizeBaseUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    return new URL(value).href.replace(/\/+$/, '');
  } catch (_error) {
    console.warn('ping-opponent: invalid APP_BASE_URL, ignoring');
    return null;
  }
};

const APP_FOCUS_BASE_URL = sanitizeBaseUrl(APP_BASE_URL);

const resolveSupabase = (): ServiceSupabaseClient =>
  createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return jsonResponse({}, { status: 200 });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Missing authorization token' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return jsonResponse({ error: 'Invalid authorization token' }, { status: 401 });
  }

  let payload: PingOpponentRequest;
  try {
    payload = (await req.json()) as PingOpponentRequest;
  } catch (error) {
    console.error('ping-opponent: invalid JSON body', error);
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const matchId = typeof payload.matchId === 'string' && payload.matchId.trim().length > 0 ? payload.matchId.trim() : null;
  if (!matchId) {
    return jsonResponse({ error: 'matchId is required' }, { status: 400 });
  }

  const supabase = resolveSupabase();

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    console.error('ping-opponent: failed to authenticate user', authError);
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: senderProfile, error: profileError } = await supabase
    .from('players')
    .select('id, display_name')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  if (profileError || !senderProfile) {
    console.error('ping-opponent: failed to load player profile', profileError);
    return jsonResponse({ error: 'Player profile not found' }, { status: 403 });
  }

  const { data: matchRecord, error: matchError } = await supabase
    .from('matches')
    .select(
      'id, status, creator_id, opponent_id, creator:creator_id (id, display_name), opponent:opponent_id (id, display_name)',
    )
    .eq('id', matchId)
    .maybeSingle();
  if (matchError || !matchRecord) {
    console.error('ping-opponent: match not found', matchError);
    return jsonResponse({ error: 'Match not found' }, { status: 404 });
  }

  const match = matchRecord as MatchRecord;
  if (match.status !== 'in_progress' || !match.opponent_id) {
    return jsonResponse({ error: 'Ping is only available during active games' }, { status: 409 });
  }

  const isCreator = match.creator_id === senderProfile.id;
  const isOpponent = match.opponent_id === senderProfile.id;
  if (!isCreator && !isOpponent) {
    return jsonResponse({ error: 'You must be a participant to ping the opponent' }, { status: 403 });
  }

  const recipientId = isCreator ? match.opponent_id : match.creator_id;
  if (!recipientId) {
    return jsonResponse({ error: 'Opponent profile unavailable' }, { status: 422 });
  }

  const cutoff = new Date(Date.now() - MATCH_PING_COOLDOWN_MS).toISOString();
  const { data: recentPings, error: pingFetchError } = await supabase
    .from('match_ping_events')
    .select('id, created_at')
    .eq('match_id', match.id)
    .eq('sender_id', senderProfile.id)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1);
  if (pingFetchError) {
    console.error('ping-opponent: failed to check rate limit', pingFetchError);
    return jsonResponse({ error: 'Unable to evaluate rate limit' }, { status: 500 });
  }

  if (recentPings && recentPings.length > 0) {
    const lastPingAt = recentPings[0]?.created_at ?? null;
    const retryAfterMs =
      lastPingAt && Number.isFinite(Date.parse(lastPingAt))
        ? Math.max(0, MATCH_PING_COOLDOWN_MS - (Date.now() - Date.parse(lastPingAt)))
        : MATCH_PING_COOLDOWN_MS;
    return jsonResponse(
      {
        error: 'Too many pings. Please wait before notifying again.',
        code: 'PING_RATE_LIMIT',
        lastPingAt,
        retryAfterMs,
      },
      { status: 429 },
    );
  }

  const { data: recorded, error: recordError } = await supabase
    .from('match_ping_events')
    .insert({
      match_id: match.id,
      sender_id: senderProfile.id,
      recipient_id: recipientId,
    })
    .select('id, created_at')
    .single();
  if (recordError || !recorded) {
    console.error('ping-opponent: failed to record ping event', recordError);
    return jsonResponse({ error: 'Unable to record ping request' }, { status: 500 });
  }

  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from('web_push_subscriptions')
    .select('id, endpoint, p256dh, auth, encoding')
    .eq('profile_id', recipientId);
  if (subscriptionsError) {
    console.error('ping-opponent: failed to load push subscriptions', subscriptionsError);
    return jsonResponse({ error: 'Unable to load opponent notification targets' }, { status: 500 });
  }

  let delivered = 0;
  const attempts = subscriptions?.length ?? 0;
  if (subscriptions && subscriptions.length > 0) {
    const senderName = senderProfile.display_name ?? 'Your opponent';
    const focusUrl = APP_FOCUS_BASE_URL ? `${APP_FOCUS_BASE_URL}#play` : null;
    const payload = {
      title: `${senderName} pinged you`,
      body: 'Jump back into Santorini to continue your match.',
      tag: `match-${match.id}-ping`,
      data: focusUrl ? { matchId: match.id, focusUrl } : { matchId: match.id },
      requireInteraction: true,
    };

    const results = await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        const storedSubscription = subscription as StoredPushSubscription;
        const result = await sendPushNotificationWithRetry(storedSubscription, payload);
        if (!result.delivered && (result.reason === 'gone' || result.reason === 'unauthorized')) {
          await supabase.from('web_push_subscriptions').delete().eq('id', storedSubscription.id);
        }
        if (result.delivered) {
          delivered += 1;
        }
        return result;
      }),
    );

    const rejected = results.filter((entry) => entry.status === 'rejected');
    if (rejected.length > 0) {
      console.warn('ping-opponent: unhandled errors while sending push notifications', rejected);
    }
  }

  return jsonResponse({
    matchId: match.id,
    recordedAt: recorded.created_at,
    notificationsAttempted: attempts,
    notificationsDelivered: delivered,
    cooldownMs: MATCH_PING_COOLDOWN_MS,
  });
});
