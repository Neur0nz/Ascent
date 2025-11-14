import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import { SantoriniEngine } from '../_shared/santorini.ts';

type MatchVisibility = 'public' | 'private';
type StartingPlayer = 'creator' | 'opponent' | 'random';

interface CreateMatchRequest {
  visibility?: MatchVisibility;
  rated?: boolean;
  hasClock?: boolean;
  clockInitialMinutes?: number;
  clockIncrementSeconds?: number;
  startingPlayer?: StartingPlayer;
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

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return fallback;
}

function normalizeNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function generateJoinCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i += 1) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    result += alphabet[buffer[0] % alphabet.length];
  }
  return result;
}

serve(async (req) => {
  // Handle CORS preflight requests
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

  let payload: CreateMatchRequest;
  try {
    payload = (await req.json()) as CreateMatchRequest;
  } catch (error) {
    console.error('Failed to parse request payload', error);
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const visibility = (payload.visibility === 'private' ? 'private' : 'public') as MatchVisibility;
  const rated = normalizeBoolean(payload.rated, true);
  const hasClock = normalizeBoolean(payload.hasClock, true);
  const initialMinutes = normalizeNumber(payload.clockInitialMinutes, 10);
  const incrementSeconds = normalizeNumber(payload.clockIncrementSeconds, 5);
  
  // Determine starting player
  let startingPlayerOption = payload.startingPlayer || 'creator';
  if (!['creator', 'opponent', 'random'].includes(startingPlayerOption)) {
    startingPlayerOption = 'creator';
  }
  
  let startingPlayerIndex = 0; // 0 = creator, 1 = opponent
  if (startingPlayerOption === 'opponent') {
    startingPlayerIndex = 1;
  } else if (startingPlayerOption === 'random') {
    startingPlayerIndex = Math.random() < 0.5 ? 0 : 1;
  }

  const clockInitialSeconds = hasClock ? Math.max(0, Math.round(initialMinutes * 60)) : 0;
  const clockIncrementSeconds = hasClock ? Math.max(0, Math.round(incrementSeconds)) : 0;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    console.error('Failed to authenticate user via token', authError);
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from('players')
    .select('*')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    console.error('Failed to locate player profile', profileError);
    return jsonResponse({ error: 'Player profile not found' }, { status: 403 });
  }

  // Check for existing active games
  const { data: existingMatches, error: checkError } = await supabase
    .from('matches')
    .select('id, status, creator_id, opponent_id')
    .or(`creator_id.eq.${profile.id},opponent_id.eq.${profile.id}`)
    .in('status', ['waiting_for_opponent', 'in_progress'])
    .limit(1);

  if (checkError) {
    console.error('Failed to check for existing matches', checkError);
    return jsonResponse({ error: 'Failed to check for existing matches' }, { status: 500 });
  }

  if (existingMatches && existingMatches.length > 0) {
    return jsonResponse({ 
      error: 'You already have an active game. Please finish or cancel your current game before creating a new one.',
      code: 'ACTIVE_GAME_EXISTS',
      activeMatchId: existingMatches[0].id
    }, { status: 409 });
  }

  const joinCode = visibility === 'private' ? generateJoinCode() : null;

  const { snapshot } = SantoriniEngine.createInitial(startingPlayerIndex);
  console.log('Creating match with starting player:', startingPlayerIndex, 'from option:', startingPlayerOption);

  const insertPayload = {
    creator_id: profile.id,
    visibility,
    rated,
    private_join_code: joinCode,
    clock_initial_seconds: clockInitialSeconds,
    clock_increment_seconds: clockIncrementSeconds,
    initial_state: snapshot,
  };

  const { data: match, error: insertError } = await supabase
    .from('matches')
    .insert(insertPayload)
    .select(
      '*, creator:creator_id (id, auth_user_id, display_name, rating, games_played, created_at, updated_at, show_coordinate_labels), ' +
        'opponent:opponent_id (id, auth_user_id, display_name, rating, games_played, created_at, updated_at, show_coordinate_labels)',
    )
    .single();

  if (insertError || !match) {
    const postgresError = insertError as { code?: string; message?: string } | null;
    if (postgresError?.code === '23505') {
      const { data: activeMatch } = await supabase
        .from('matches')
        .select('id')
        .or(`creator_id.eq.${profile.id},opponent_id.eq.${profile.id}`)
        .in('status', ['waiting_for_opponent', 'in_progress'])
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return jsonResponse(
        {
          error: 'You already have an active game. Please finish or cancel your current game before creating a new one.',
          code: 'ACTIVE_GAME_EXISTS',
          activeMatchId: activeMatch?.id ?? null,
        },
        { status: 409 },
      );
    }
    console.error('Failed to create match', insertError);
    return jsonResponse({ error: 'Failed to create match' }, { status: 500 });
  }

  return jsonResponse({ match }, { status: 201 });
});
