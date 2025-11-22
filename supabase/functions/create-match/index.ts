import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import { SantoriniEngine } from '../_shared/santorini.ts';

type MatchVisibility = 'public' | 'private';
type StartingPlayer = 'creator' | 'opponent' | 'random';
type OpponentType = 'human' | 'ai';

const MATCH_WITH_PROFILES =
  '*, creator:creator_id (id, auth_user_id, display_name, rating, games_played, created_at, updated_at, show_coordinate_labels), '
  + 'opponent:opponent_id (id, auth_user_id, display_name, rating, games_played, created_at, updated_at, show_coordinate_labels)';

interface CreateMatchRequest {
  visibility?: MatchVisibility;
  rated?: boolean;
  hasClock?: boolean;
  clockInitialMinutes?: number;
  clockIncrementSeconds?: number;
  startingPlayer?: StartingPlayer;
  opponentType?: OpponentType;
  aiDepth?: number;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const AI_PLAYER_ID = Deno.env.get('AI_PLAYER_ID') ?? '00000000-0000-0000-0000-00000000a11a';
const DEFAULT_AI_DEPTH = 200;

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

  if (!SUPABASE_URL || (!SUPABASE_ANON_KEY && !SERVICE_ROLE_KEY)) {
    console.error('create-match: missing SUPABASE_URL or API keys');
    return jsonResponse({ error: 'Service misconfigured' }, { status: 500 });
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

  const opponentType: OpponentType = payload.opponentType === 'ai' ? 'ai' : 'human';
  const requestedVisibility = (payload.visibility === 'private' ? 'private' : 'public') as MatchVisibility;
  const visibility: MatchVisibility = opponentType === 'ai' ? 'private' : requestedVisibility;
  const rated = opponentType === 'ai' ? false : normalizeBoolean(payload.rated, true);
  const hasClock = opponentType === 'ai' ? false : normalizeBoolean(payload.hasClock, true);
  const initialMinutes = normalizeNumber(payload.clockInitialMinutes, 10);
  const incrementSeconds = normalizeNumber(payload.clockIncrementSeconds, 5);
  const aiDepth = opponentType === 'ai'
    ? Math.max(10, Math.min(5000, Math.round(normalizeNumber(payload.aiDepth, DEFAULT_AI_DEPTH))))
    : null;
  const opponentId = opponentType === 'ai' ? AI_PLAYER_ID : null;
  const isAiMatch = opponentType === 'ai';
  
  // Determine starting player
  let startingPlayerOption = payload.startingPlayer || 'creator';
  if (!['creator', 'opponent', 'random'].includes(startingPlayerOption)) {
    startingPlayerOption = 'creator';
  }
  
  let resolvedStartingRole: 'creator' | 'opponent' = 'creator';
  if (startingPlayerOption === 'opponent') {
    resolvedStartingRole = 'opponent';
  } else if (startingPlayerOption === 'random') {
    resolvedStartingRole = Math.random() < 0.5 ? 'creator' : 'opponent';
  }
  const playerZeroRole = resolvedStartingRole;
  const startingPlayerIndex = playerZeroRole === 'creator' ? 0 : 1;

  const initialMetadata: { playerZeroRole: typeof playerZeroRole; aiDepth?: number } = { playerZeroRole };
  if (opponentType === 'ai' && typeof aiDepth === 'number') {
    initialMetadata.aiDepth = aiDepth;
  }

  const clockInitialSeconds = hasClock ? Math.max(0, Math.round(initialMinutes * 60)) : 0;
  const clockIncrementSeconds = hasClock ? Math.max(0, Math.round(incrementSeconds)) : 0;

  const supabaseAnonKey = SUPABASE_ANON_KEY ?? SERVICE_ROLE_KEY!;
  const supabaseAdminKey = SERVICE_ROLE_KEY ?? supabaseAnonKey;
  // Client for queries that should run as the authenticated user (respecting RLS)
  const supabase = createClient(SUPABASE_URL, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  // Admin client is only needed for provisioning the AI profile; fallback to user client if service key missing.
  const supabaseAdmin =
    SERVICE_ROLE_KEY && SUPABASE_URL
      ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
      : supabase;

  if (opponentType === 'ai') {
    if (!SERVICE_ROLE_KEY) {
      console.error('AI match requested but SUPABASE_SERVICE_ROLE_KEY is not configured');
      return jsonResponse({ error: 'AI opponent unavailable right now' }, { status: 503 });
    }
    try {
      await ensureAiProfile(supabaseAdmin);
    } catch (error) {
      console.error('Failed to ensure AI profile exists', error);
      return jsonResponse({ error: 'Failed to provision AI opponent' }, { status: 500 });
    }
  }

async function ensureAiProfile(client: ReturnType<typeof createClient>) {
  const { data, error } = await client
    .from('players')
    .select('id')
    .eq('id', AI_PLAYER_ID)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  if (data) {
    return data;
  }

  const { data: inserted, error: insertError } = await client
    .from('players')
    .insert({
      id: AI_PLAYER_ID,
      auth_user_id: null,
      display_name: 'Santorini AI',
      avatar_url: null,
      rating: 1500,
      games_played: 0,
      engine_preference: 'python',
      show_coordinate_labels: true,
    })
    .select('id')
    .single();

  if (insertError) {
    throw insertError;
  }
  return inserted;
}

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
  if (opponentType === 'human') {
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
  } else {
    const { data: existingAiMatches, error: aiCheckError } = await supabase
      .from('matches')
      .select('id, opponent_id, status')
      .eq('creator_id', profile.id)
      .in('status', ['in_progress'])
      .limit(10);
    if (aiCheckError) {
      console.error('Failed to check for existing AI matches', aiCheckError);
      return jsonResponse({ error: 'Failed to check for existing matches' }, { status: 500 });
    }
    const activeAiMatch = existingAiMatches?.find((match) => match.opponent_id === AI_PLAYER_ID);
    if (activeAiMatch) {
      return jsonResponse({
        error: 'Finish your current AI game before starting another one.',
        code: 'ACTIVE_AI_GAME_EXISTS',
        activeMatchId: activeAiMatch.id,
      }, { status: 409 });
    }
  }

  const joinCode = opponentType === 'human' ? generateJoinCode() : null;

  const { snapshot } = SantoriniEngine.createInitial(startingPlayerIndex, initialMetadata);
  console.log('Creating match with starting role:', playerZeroRole, 'from option:', startingPlayerOption);

  const insertPayload = {
    creator_id: profile.id,
    opponent_id: opponentId,
    visibility,
    rated,
    private_join_code: joinCode,
    clock_initial_seconds: clockInitialSeconds,
    clock_increment_seconds: clockIncrementSeconds,
    initial_state: snapshot,
    is_ai_match: isAiMatch,
    ai_depth: aiDepth,
    ...(opponentType === 'ai' ? { status: 'in_progress' as const } : {}),
  };

  const { data: match, error: insertError } = await supabase
    .from('matches')
    .insert(insertPayload)
    .select(MATCH_WITH_PROFILES)
    .single();

  if (insertError || !match) {
    const postgresError = insertError as { code?: string; message?: string; details?: string } | null;
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
    return jsonResponse(
      {
        error: 'Failed to create match',
        code: postgresError?.code ?? 'CREATE_MATCH_FAILED',
        hint: postgresError?.message ?? undefined,
        details: postgresError?.details ?? undefined,
      },
      { status: 500 },
    );
  }

  let enrichedMatch = match;
  if (opponentType === 'ai' && match.status !== 'in_progress') {
    const { data: patchedMatch, error: patchError } = await supabase
      .from('matches')
      .update({ status: 'in_progress' })
      .eq('id', match.id)
      .select(MATCH_WITH_PROFILES)
      .single();
    if (patchError) {
      console.warn('create-match: failed to mark AI match as in_progress', patchError);
    } else if (patchedMatch) {
      enrichedMatch = patchedMatch;
    }
  }

  return jsonResponse({ match: enrichedMatch }, { status: 201 });
});
