import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase configuration environment variables');
}

interface SyncPushSubscriptionRequest {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
  encoding?: string | null;
  userAgent?: string | null;
}

type ServiceSupabaseClient = SupabaseClient<any, any, any>;

const jsonResponse = (body: Record<string, unknown>, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    ...init,
  });

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

  let payload: SyncPushSubscriptionRequest;
  try {
    payload = (await req.json()) as SyncPushSubscriptionRequest;
  } catch (error) {
    console.error('sync-push-subscription: invalid JSON body', error);
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const endpoint = typeof payload.endpoint === 'string' ? payload.endpoint.trim() : '';
  const p256dh = payload.keys?.p256dh ?? null;
  const authSecret = payload.keys?.auth ?? null;

  if (!endpoint || !p256dh || !authSecret) {
    return jsonResponse({ error: 'Push subscription is missing required keys' }, { status: 422 });
  }

  const supabase = resolveSupabase();

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    console.error('sync-push-subscription: failed to authenticate user', authError);
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = authData.user.id;
  const { data: profile, error: profileError } = await supabase
    .from('players')
    .select('id')
    .eq('auth_user_id', userId)
    .maybeSingle();

  if (profileError || !profile) {
    console.error('sync-push-subscription: player profile not found', profileError);
    return jsonResponse({ error: 'Player profile not found' }, { status: 403 });
  }

  const now = new Date().toISOString();
  const { error: upsertError } = await supabase.from('web_push_subscriptions').upsert(
    {
      auth_user_id: userId,
      profile_id: profile.id,
      endpoint,
      p256dh,
      auth: authSecret,
      encoding: payload.encoding ?? 'aesgcm',
      user_agent: payload.userAgent ?? null,
      last_used_at: now,
      updated_at: now,
    },
    { onConflict: 'endpoint' },
  );

  if (upsertError) {
    console.error('sync-push-subscription: failed to store subscription', upsertError);
    return jsonResponse({ error: 'Failed to store push subscription' }, { status: 500 });
  }

  return jsonResponse({ success: true }, { status: 200 });
});
