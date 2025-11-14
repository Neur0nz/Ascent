import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

type MatchStatus = 'waiting_for_opponent' | 'in_progress' | 'completed' | 'abandoned';

interface UpdateMatchStatusRequest {
  matchId?: string;
  status?: MatchStatus;
  winnerId?: string | null;
  reason?: 'resign' | 'timeout' | 'manual';
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

function isValidStatus(value: unknown): value is MatchStatus {
  return value === 'waiting_for_opponent' || value === 'in_progress' || value === 'completed' || value === 'abandoned';
}

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

  let payload: UpdateMatchStatusRequest;
  try {
    payload = (await req.json()) as UpdateMatchStatusRequest;
  } catch (error) {
    console.error('Failed to parse update-match-status payload', error);
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!payload?.matchId || typeof payload.matchId !== 'string') {
    return jsonResponse({ error: 'Missing match identifier' }, { status: 400 });
  }
  if (!isValidStatus(payload.status)) {
    return jsonResponse({ error: 'Unsupported match status' }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    console.error('Failed to authenticate request token', authError);
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from('players')
    .select('id')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    console.error('Failed to locate player profile for update-match-status', profileError);
    return jsonResponse({ error: 'Player profile not found' }, { status: 403 });
  }

  const { data: match, error: matchError } = await supabase
    .from('matches')
    .select('id, status, creator_id, opponent_id, winner_id')
    .eq('id', payload.matchId)
    .maybeSingle();

  if (matchError || !match) {
    console.error('Failed to load match for update-match-status', matchError);
    return jsonResponse({ error: 'Match not found' }, { status: 404 });
  }

  const playerId = profile.id;
  const isCreator = match.creator_id === playerId;
  const isOpponent = match.opponent_id === playerId;

  if (!isCreator && !isOpponent) {
    return jsonResponse({ error: 'You are not a participant in this match' }, { status: 403 });
  }

  if (match.status === 'completed' || match.status === 'abandoned') {
    return jsonResponse({ error: 'Match is already finished' }, { status: 409 });
  }

  if (payload.status === 'waiting_for_opponent') {
    return jsonResponse({ error: 'Cannot revert match to waiting state' }, { status: 400 });
  }

  if (payload.status === 'completed' && !match.opponent_id) {
    return jsonResponse({ error: 'Match has no opponent yet' }, { status: 409 });
  }

  let nextWinner: string | null = null;
  if (payload.status === 'completed') {
    if (payload.winnerId == null) {
      return jsonResponse({ error: 'Winner is required when completing a match' }, { status: 400 });
    }
    if (payload.winnerId !== match.creator_id && payload.winnerId !== match.opponent_id) {
      return jsonResponse({ error: 'Winner must be one of the participants' }, { status: 400 });
    }
    nextWinner = payload.winnerId;
  } else if (payload.status === 'abandoned' && match.status === 'in_progress') {
    // For resignations we always award the win to the opponent if provided
    if (payload.winnerId) {
      if (payload.winnerId !== match.creator_id && payload.winnerId !== match.opponent_id) {
        return jsonResponse({ error: 'Winner must be one of the participants' }, { status: 400 });
      }
      nextWinner = payload.winnerId;
    } else {
      nextWinner = isCreator ? match.opponent_id : match.creator_id;
    }
  }

  const updates: Record<string, unknown> = {
    status: payload.status,
    winner_id: nextWinner ?? null,
    clock_updated_at: new Date().toISOString(),
  };

  const { data: updatedMatch, error: updateError } = await supabase
    .from('matches')
    .update(updates)
    .eq('id', match.id)
    .select(
      '*, creator:creator_id (id, auth_user_id, display_name, rating, games_played, created_at, updated_at, show_coordinate_labels), ' +
        'opponent:opponent_id (id, auth_user_id, display_name, rating, games_played, created_at, updated_at, show_coordinate_labels)',
    )
    .maybeSingle();

  if (updateError || !updatedMatch) {
    console.error('Failed to apply update-match-status', updateError);
    return jsonResponse({ error: 'Failed to update match status' }, { status: 500 });
  }

  return jsonResponse({ match: updatedMatch });
});
