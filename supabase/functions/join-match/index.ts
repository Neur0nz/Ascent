import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

type MatchVisibility = 'public' | 'private';
type MatchStatus = 'waiting_for_opponent' | 'in_progress' | 'completed' | 'abandoned';

const MATCH_WITH_PROFILES =
  '*, creator:creator_id (id, auth_user_id, display_name, rating, games_played, created_at, updated_at, show_coordinate_labels), '
  + 'opponent:opponent_id (id, auth_user_id, display_name, rating, games_played, created_at, updated_at, show_coordinate_labels)';

interface JoinMatchRequest {
  identifier?: string; // match id or private join code
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase configuration environment variables');
}

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return jsonResponse({}, { status: 200 });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Missing authorization token' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return jsonResponse({ error: 'Invalid authorization token' }, { status: 401 });
  }

  let payload: JoinMatchRequest;
  try {
    payload = (await req.json()) as JoinMatchRequest;
  } catch (error) {
    console.error('join-match: invalid JSON', error);
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawIdentifier = (payload.identifier ?? '').trim();
  if (!rawIdentifier) {
    return jsonResponse({ error: 'identifier is required' }, { status: 400 });
  }

  const isCode = rawIdentifier.length <= 8;
  const normalizedIdentifier = isCode ? rawIdentifier.toUpperCase() : rawIdentifier;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    console.error('join-match: auth failed', authError);
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from('players')
    .select('*')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  if (profileError || !profile) {
    console.error('join-match: player profile not found', profileError);
    return jsonResponse({ error: 'Player profile not found' }, { status: 403 });
  }

  let targetMatchId: string | null = null;
  let privateJoinCode: string | null = null;
  let matchVisibility: MatchVisibility | null = null;
  let matchStatus: MatchStatus | null = null;
  let opponentId: string | null = null;
  let creatorId: string | null = null;

  // Look up the match by code or id using service role (bypasses RLS safely)
  const { data: matchRecord, error: matchError } = await supabase
    .from('matches')
    .select('id, visibility, status, private_join_code, creator_id, opponent_id')
    .eq(isCode ? 'private_join_code' : 'id', normalizedIdentifier)
    .maybeSingle();

  if (matchError) {
    console.error('join-match: failed to fetch match', matchError);
    return jsonResponse({ error: 'Unable to find match' }, { status: 500 });
  }
  if (!matchRecord) {
    return jsonResponse({ error: 'Match not found' }, { status: 404 });
  }

  targetMatchId = matchRecord.id as string;
  privateJoinCode = (matchRecord.private_join_code as string | null)?.toUpperCase() ?? null;
  matchVisibility = matchRecord.visibility as MatchVisibility;
  matchStatus = matchRecord.status as MatchStatus;
  opponentId = matchRecord.opponent_id as string | null;
  creatorId = matchRecord.creator_id as string | null;

  if (matchVisibility === 'private' && (!isCode || normalizedIdentifier !== privateJoinCode)) {
    return jsonResponse({ error: 'A valid join code is required for this match' }, { status: 403 });
  }

  if (matchStatus !== 'waiting_for_opponent') {
    return jsonResponse({ error: 'Match is no longer accepting players' }, { status: 409 });
  }

  if (opponentId !== null) {
    return jsonResponse({ error: 'Match already has an opponent' }, { status: 409 });
  }

  if (creatorId === profile.id) {
    return jsonResponse({ error: 'You cannot join your own match' }, { status: 400 });
  }

  const nowIso = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from('matches')
    .update({
      opponent_id: profile.id,
      status: 'in_progress',
      // Start the game clock only after an opponent successfully joins
      clock_updated_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', targetMatchId)
    .is('opponent_id', null)
    .select(MATCH_WITH_PROFILES)
    .maybeSingle();

  if (updateError) {
    console.error('join-match: failed to claim match', updateError);
    return jsonResponse({ error: 'Unable to join match right now' }, { status: 500 });
  }
  if (!updated) {
    return jsonResponse({ error: 'Match has already been joined' }, { status: 409 });
  }

  return jsonResponse({ match: updated });
});
