import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';
import { SantoriniEngine, SantoriniStateSnapshot } from '../_shared/santorini.ts';
import { sendPushNotificationWithRetry, type StoredPushSubscription } from '../_shared/push.ts';

interface SantoriniMoveAction {
  kind: 'santorini.move';
  move: number;
  by?: 'creator' | 'opponent';
  clocks?: { creatorMs?: number; opponentMs?: number } | null;
}

interface UndoAcceptAction {
  kind: 'undo.accept';
  moveIndex?: number | null;
}

interface UndoRejectAction {
  kind: 'undo.reject';
  moveIndex?: number | null;
}

type SupportedAction = SantoriniMoveAction | UndoAcceptAction | UndoRejectAction;

interface SubmitMoveRequest {
  matchId?: string;
  moveIndex?: number;
  action?: SupportedAction;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? null;

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

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

const TOKEN_CACHE_TTL_MS = 30_000;
const MATCH_CACHE_TTL_MS = 120_000;
const MAX_TOKEN_CACHE_ENTRIES = 512;
const MAX_MATCH_CACHE_ENTRIES = 256;
const ILLEGAL_WINDOW_MS = 10_000;
const ILLEGAL_MAX_ATTEMPTS = 6;
const ILLEGAL_BLOCK_MS = 5_000;
const MAX_ELAPSED_SAMPLE_MS = 12 * 60 * 60 * 1000; // clamp elapsed calculations to 12h

type ServiceSupabaseClient = SupabaseClient<any, any, any>;
type PlayerRole = 'creator' | 'opponent';

interface CachedTokenEntry {
  userId: string;
  expiresAt: number;
  lastSeen: number;
}

interface CachedParticipant {
  playerId: string;
  role: PlayerRole;
  lastSeen: number;
}

interface MatchCacheEntry {
  match: any;
  lastMove: any | null;
  lastSnapshot: SantoriniStateSnapshot;
  lastMoveIndex: number;
  participants: Map<string, CachedParticipant>;
  fetchedAt: number;
}

interface SubmissionContext {
  match: any;
  lastMove: any | null;
  snapshot: SantoriniStateSnapshot;
  lastMoveIndex: number;
  role: PlayerRole;
  playerId: string;
  fromCache: boolean;
}

interface CachedAuthResult {
  userId: string;
  fromCache: boolean;
}

interface PenaltyEntry {
  count: number;
  windowStart: number;
  blockedUntil: number | null;
}

const tokenCache = new Map<string, CachedTokenEntry>();
const matchCache = new Map<string, MatchCacheEntry>();
const penaltyTracker = new Map<string, PenaltyEntry>();

function pruneTokenCache(): void {
  if (tokenCache.size <= MAX_TOKEN_CACHE_ENTRIES) {
    return;
  }
  const entries = Array.from(tokenCache.entries()).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  for (let i = 0; i < entries.length - MAX_TOKEN_CACHE_ENTRIES; i += 1) {
    tokenCache.delete(entries[i][0]);
  }
}

function pruneMatchCache(): void {
  if (matchCache.size <= MAX_MATCH_CACHE_ENTRIES) {
    return;
  }
  const entries = Array.from(matchCache.entries()).sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  for (let i = 0; i < entries.length - MAX_MATCH_CACHE_ENTRIES; i += 1) {
    matchCache.delete(entries[i][0]);
  }
}

function cloneSnapshot(snapshot: SantoriniStateSnapshot): SantoriniStateSnapshot {
  try {
    return structuredClone(snapshot);
  } catch (_error) {
    return JSON.parse(JSON.stringify(snapshot)) as SantoriniStateSnapshot;
  }
}

function toTimestampMs(value: unknown): number | null {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function getInitialClockMs(match: any): number {
  const initialSeconds = Number(match.clock_initial_seconds ?? 0);
  if (!Number.isFinite(initialSeconds) || initialSeconds <= 0) {
    return 0;
  }
  return Math.max(0, Math.round(initialSeconds * 1000));
}

function getIncrementMs(match: any): number {
  const incrementSeconds = Number(match.clock_increment_seconds ?? 0);
  if (!Number.isFinite(incrementSeconds) || incrementSeconds <= 0) {
    return 0;
  }
  return Math.max(0, Math.round(incrementSeconds * 1000));
}

interface ComputedClockState {
  clocks?: { creatorMs: number; opponentMs: number };
  elapsedMs: number;
}

function computeServerClocks(
  match: any,
  lastMove: any | null,
  actingPlayerIndex: number,
): ComputedClockState {
  const initialMs = getInitialClockMs(match);
  if (initialMs <= 0) {
    return { clocks: undefined, elapsedMs: 0 };
  }

  const previousClocks = lastMove?.action?.clocks;
  let creatorMs = Number(previousClocks?.creatorMs);
  let opponentMs = Number(previousClocks?.opponentMs);
  if (!Number.isFinite(creatorMs) || creatorMs < 0) {
    creatorMs = initialMs;
  } else {
    creatorMs = Math.max(0, Math.round(creatorMs));
  }
  if (!Number.isFinite(opponentMs) || opponentMs < 0) {
    opponentMs = initialMs;
  } else {
    opponentMs = Math.max(0, Math.round(opponentMs));
  }

  const now = Date.now();
  const timestampSources: Array<unknown> = [lastMove?.created_at, match.clock_updated_at, match.updated_at, match.created_at];
  let referenceTimestamp = now;
  for (const source of timestampSources) {
    const parsed = toTimestampMs(source);
    if (parsed !== null) {
      referenceTimestamp = parsed;
      break;
    }
  }

  let elapsedMs = Math.max(0, now - referenceTimestamp);
  if (elapsedMs > MAX_ELAPSED_SAMPLE_MS) {
    elapsedMs = MAX_ELAPSED_SAMPLE_MS;
  }

  if (actingPlayerIndex === 0) {
    creatorMs = Math.max(0, creatorMs - elapsedMs);
  } else if (actingPlayerIndex === 1) {
    opponentMs = Math.max(0, opponentMs - elapsedMs);
  }

  const incrementMs = getIncrementMs(match);
  if (incrementMs > 0) {
    if (actingPlayerIndex === 0) {
      creatorMs += incrementMs;
    } else if (actingPlayerIndex === 1) {
      opponentMs += incrementMs;
    }
  }

  console.log(
    '⏳ Server clock update - elapsedMs:',
    elapsedMs,
    'creatorMs ->',
    creatorMs,
    'opponentMs ->',
    opponentMs,
  );

  return {
    clocks: {
      creatorMs,
      opponentMs,
    },
    elapsedMs,
  };
}

function extractTokenExpiry(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
  try {
    const json = atob(padded);
    const parsed = JSON.parse(json) as { exp?: number };
    if (typeof parsed.exp === 'number' && Number.isFinite(parsed.exp)) {
      return parsed.exp * 1000;
    }
  } catch (_error) {
    // Ignore malformed token payloads
  }
  return null;
}

function computeTokenCacheExpiry(token: string, now: number): number {
  const fallback = now + TOKEN_CACHE_TTL_MS;
  const exp = extractTokenExpiry(token);
  if (!exp || exp <= now) {
    return fallback;
  }
  return Math.max(now + 1000, Math.min(fallback, exp - 1000));
}

async function getAuthUserId(
  supabase: ServiceSupabaseClient,
  token: string,
): Promise<CachedAuthResult> {
  const now = Date.now();
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > now) {
    cached.lastSeen = now;
    return { userId: cached.userId, fromCache: true };
  }
  if (cached) {
    tokenCache.delete(token);
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    console.error('submit-move: auth.getUser failed for token', {
      error: error?.message ?? error,
      hasUser: Boolean(data?.user),
    });
    throw new HttpError(401, 'Unauthorized');
  }
  const expiresAt = computeTokenCacheExpiry(token, now);
  tokenCache.set(token, { userId: data.user.id, expiresAt, lastSeen: now });
  pruneTokenCache();
  return { userId: data.user.id, fromCache: false };
}

function cacheParticipant(
  entry: MatchCacheEntry,
  authUserId: string,
  playerId: string,
  role: PlayerRole,
  timestamp: number,
): void {
  if (!entry.participants) {
    entry.participants = new Map();
  }
  entry.participants.set(authUserId, { playerId, role, lastSeen: timestamp });
}

async function loadSubmissionContext(
  supabase: ServiceSupabaseClient,
  authUserId: string,
  matchId: string,
): Promise<SubmissionContext> {
  const now = Date.now();
  const cachedEntry = matchCache.get(matchId);
  const cachedParticipant = cachedEntry?.participants?.get(authUserId);
  if (cachedEntry && cachedParticipant && now - cachedEntry.fetchedAt <= MATCH_CACHE_TTL_MS) {
    cachedEntry.fetchedAt = now;
    cachedParticipant.lastSeen = now;
    const context: SubmissionContext = {
      match: cachedEntry.match,
      lastMove: cachedEntry.lastMove,
      snapshot: cloneSnapshot(cachedEntry.lastSnapshot),
      lastMoveIndex: cachedEntry.lastMoveIndex,
      role: cachedParticipant.role,
      playerId: cachedParticipant.playerId,
      fromCache: true,
    };
    console.log('Cache hit for match', matchId, '- participant', cachedParticipant.role, 'moveIndex', context.lastMoveIndex);
    return context;
  }

  const { data, error } = await (supabase as any)
    .rpc('get_move_submission_data', {
      p_auth_user_id: authUserId,
      p_match_id: matchId,
    })
    .maybeSingle();

  if (error || !data) {
    throw new HttpError(404, 'Unable to load match data');
  }

  const match = data.match_data as any;
  const lastMove = (data.last_move_data as any) ?? null;

  if (!match?.initial_state) {
    throw new HttpError(500, 'Match state is unavailable');
  }

  const sourceSnapshot = (lastMove?.state_snapshot ?? match.initial_state) as SantoriniStateSnapshot;
  const storedSnapshot = cloneSnapshot(sourceSnapshot);
  const lastMoveIndex = typeof lastMove?.move_index === 'number' ? lastMove.move_index : -1;

  const entry: MatchCacheEntry =
    cachedEntry ??
    ({
      match,
      lastMove,
      lastSnapshot: storedSnapshot,
      lastMoveIndex,
      participants: new Map<string, CachedParticipant>(),
      fetchedAt: now,
    } as MatchCacheEntry);

  entry.match = match;
  entry.lastMove = lastMove;
  entry.lastSnapshot = storedSnapshot;
  entry.lastMoveIndex = lastMoveIndex;
  entry.fetchedAt = now;
  cacheParticipant(entry, authUserId, data.player_id as string, data.player_role as PlayerRole, now);

  matchCache.set(matchId, entry);
  pruneMatchCache();

  const context: SubmissionContext = {
    match,
    lastMove,
    snapshot: cloneSnapshot(storedSnapshot),
    lastMoveIndex,
    role: data.player_role as PlayerRole,
    playerId: data.player_id as string,
    fromCache: false,
  };
  console.log('📦  Cache miss for match', matchId, '- hydrated to moveIndex', lastMoveIndex);
  return context;
}

function updateMatchCacheAfterMove(
  matchId: string,
  authUserId: string,
  playerId: string,
  role: PlayerRole,
  match: any,
  move: any,
  snapshot: SantoriniStateSnapshot,
): void {
  const now = Date.now();
  const entry =
    matchCache.get(matchId) ??
    ({
      match,
      lastMove: move,
      lastSnapshot: cloneSnapshot(snapshot),
      lastMoveIndex: typeof move?.move_index === 'number' ? move.move_index : -1,
      participants: new Map<string, CachedParticipant>(),
      fetchedAt: now,
    } as MatchCacheEntry);

  entry.match = match;
  entry.lastMove = move;
  entry.lastSnapshot = cloneSnapshot(snapshot);
  entry.lastMoveIndex = typeof move?.move_index === 'number' ? move.move_index : entry.lastMoveIndex;
  entry.fetchedAt = now;
  cacheParticipant(entry, authUserId, playerId, role, now);

  matchCache.set(matchId, entry);
  pruneMatchCache();
  console.log('📝  Cache updated after move for match', matchId, '- new moveIndex', entry.lastMoveIndex);
}

function updateMatchCacheAfterUndo(
  matchId: string,
  authUserId: string,
  playerId: string,
  role: PlayerRole,
  match: any,
  restoredSnapshot: SantoriniStateSnapshot,
  previousMove: any | null,
): void {
  const now = Date.now();
  const entry =
    matchCache.get(matchId) ??
    ({
      match,
      lastMove: previousMove,
      lastSnapshot: cloneSnapshot(restoredSnapshot),
      lastMoveIndex: typeof previousMove?.move_index === 'number' ? previousMove.move_index : -1,
      participants: new Map<string, CachedParticipant>(),
      fetchedAt: now,
    } as MatchCacheEntry);

  entry.match = match;
  entry.lastMove = previousMove ?? null;
  entry.lastSnapshot = cloneSnapshot(restoredSnapshot);
  entry.lastMoveIndex = typeof previousMove?.move_index === 'number' ? previousMove.move_index : -1;
  entry.fetchedAt = now;
  cacheParticipant(entry, authUserId, playerId, role, now);

  matchCache.set(matchId, entry);
  pruneMatchCache();
  console.log('↩️  Cache rewound for match', matchId, '- restored moveIndex', entry.lastMoveIndex);
}

function isUserBlocked(userId: string): boolean {
  const now = Date.now();
  const entry = penaltyTracker.get(userId);
  if (!entry) {
    return false;
  }
  if (entry.blockedUntil && entry.blockedUntil > now) {
    console.warn('🚫  Blocking request for user', userId, '- blocked until', new Date(entry.blockedUntil).toISOString());
    return true;
  }
  if (entry.blockedUntil && entry.blockedUntil <= now) {
    penaltyTracker.delete(userId);
    return false;
  }
  if (now - entry.windowStart > ILLEGAL_WINDOW_MS) {
    penaltyTracker.delete(userId);
  }
  return false;
}

function recordIllegalMoveAttempt(userId: string): boolean {
  const now = Date.now();
  const entry = penaltyTracker.get(userId) ?? {
    count: 0,
    windowStart: now,
    blockedUntil: null,
  };
  if (entry.blockedUntil && entry.blockedUntil > now) {
    penaltyTracker.set(userId, entry);
    return true;
  }
  if (now - entry.windowStart > ILLEGAL_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  if (entry.count >= ILLEGAL_MAX_ATTEMPTS) {
    entry.blockedUntil = now + ILLEGAL_BLOCK_MS;
    entry.count = 0;
    penaltyTracker.set(userId, entry);
    console.warn('🚫  User', userId, 'temporarily blocked for repeated illegal moves');
    return true;
  }
  entry.blockedUntil = null;
  penaltyTracker.set(userId, entry);
  console.warn('⚠️  Illegal move attempt recorded for user', userId, '- count', entry.count);
  return false;
}

function clearIllegalMovePenalties(userId: string): void {
  penaltyTracker.delete(userId);
  console.log('✅  Cleared penalty counter for user', userId);
}

interface PlayerSummary {
  id: string;
  display_name: string | null;
  auth_user_id: string | null;
}

const sanitizeBaseUrl = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).href.replace(/\/+$/, '');
  } catch (_error) {
    console.warn('submit-move: invalid APP_BASE_URL, ignoring');
    return null;
  }
};

const APP_FOCUS_BASE_URL = sanitizeBaseUrl(APP_BASE_URL);

async function fetchPlayerSummaries(
  client: ServiceSupabaseClient,
  ids: string[],
): Promise<PlayerSummary[]> {
  const uniqueIds = Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)));
  if (!uniqueIds.length) {
    return [];
  }
  const { data, error } = await client
    .from('players')
    .select('id, display_name, auth_user_id')
    .in('id', uniqueIds);
  if (error) {
    console.warn('submit-move: failed to fetch player summaries', { ids: uniqueIds, error });
    return [];
  }
  return (Array.isArray(data) ? data : []) as PlayerSummary[];
}

async function notifyOpponentOfTurn(options: {
  supabase: ServiceSupabaseClient;
  match: any;
  actorPlayerId: string;
  actorRole: PlayerRole;
}): Promise<void> {
  const { supabase, match, actorPlayerId, actorRole } = options;
  const recipientProfileId =
    actorRole === 'creator' ? match?.opponent_id ?? null : match?.creator_id ?? null;
  if (!recipientProfileId) {
    return;
  }

  const playerSummaries = await fetchPlayerSummaries(supabase, [recipientProfileId, actorPlayerId]);
  const actor = playerSummaries.find((player) => player.id === actorPlayerId) ?? null;

  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from('web_push_subscriptions')
    .select('id, endpoint, p256dh, auth, encoding')
    .eq('profile_id', recipientProfileId);
  if (subscriptionsError) {
    console.warn('submit-move: failed to load push subscriptions', subscriptionsError);
    return;
  }
  if (!subscriptions || subscriptions.length === 0) {
    return;
  }

  const focusUrl = APP_FOCUS_BASE_URL ? `${APP_FOCUS_BASE_URL}#play` : null;
  const payload = {
    title: 'Your turn in Santorini',
    body: actor?.display_name ? `${actor.display_name} just made a move.` : 'Your opponent just made a move.',
    tag: `match-${match.id}-move`,
    data: focusUrl ? { focusUrl, matchId: match.id } : { matchId: match.id },
    requireInteraction: true,
  };

  const results = await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      const storedSubscription = subscription as StoredPushSubscription;
      const result = await sendPushNotificationWithRetry(storedSubscription, payload);
      if (!result.delivered && (result.reason === 'gone' || result.reason === 'unauthorized')) {
        await supabase.from('web_push_subscriptions').delete().eq('id', storedSubscription.id);
      }
      return result;
    }),
  );

  const failed = results.filter((entry) => entry.status === 'rejected');
  if (failed.length > 0) {
    console.warn('submit-move: unhandled errors when sending push notifications', failed);
  }
}

serve(async (req) => {
  const startTime = performance.now();
  console.log('⏱️ [START] submit-move request received');
  
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

  let payload: SubmitMoveRequest;
  try {
    payload = (await req.json()) as SubmitMoveRequest;
  } catch (error) {
    console.error('Failed to parse submit-move payload', error);
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }
  
  console.log(`⏱️ [${(performance.now() - startTime).toFixed(0)}ms] Payload parsed`);

  if (!payload?.matchId || typeof payload.matchId !== 'string') {
    return jsonResponse({ error: 'Missing match identifier' }, { status: 400 });
  }
  if (!payload.action) {
    return jsonResponse({ error: 'Missing action payload' }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  console.log(`⏱️ [${(performance.now() - startTime).toFixed(0)}ms] Supabase client created`);

  let authContext: CachedAuthResult;
  try {
    authContext = await getAuthUserId(supabase, token);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, { status: error.status });
    }
    console.error('Failed to authenticate request token', error);
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  }
  console.log(
    `⏱️ [${(performance.now() - startTime).toFixed(0)}ms] Auth verified${authContext.fromCache ? ' (cached)' : ''}`,
  );

  if (isUserBlocked(authContext.userId)) {
    return jsonResponse(
      { error: 'Too many invalid move attempts. Please wait a moment before trying again.' },
      { status: 429 },
    );
  }

  let submissionContext: SubmissionContext;
  try {
    submissionContext = await loadSubmissionContext(supabase, authContext.userId, payload.matchId);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, { status: error.status });
    }
    console.error('Failed to load move submission data', error);
    return jsonResponse({ error: 'Unable to load match data' }, { status: 404 });
  }

  console.log(
    `⏱️ [${(performance.now() - startTime).toFixed(0)}ms] ${
      submissionContext.fromCache
        ? 'Match state served from memory cache'
        : 'Combined data loaded (profile + match + last move)'
    }`,
  );

  const { match, lastMove, snapshot, lastMoveIndex, role, playerId } = submissionContext;

  if (!role) {
    return jsonResponse({ error: 'You are not a participant in this match' }, { status: 403 });
  }

  if (!match.opponent_id) {
    return jsonResponse({ error: 'Match has not been joined yet' }, { status: 409 });
  }

  if (match.status === 'completed' || match.status === 'abandoned') {
    return jsonResponse({ error: 'Match can no longer accept moves' }, { status: 409 });
  }

  if (!match.initial_state) {
    console.error('Match is missing initial state snapshot');
    return jsonResponse({ error: 'Match state is unavailable' }, { status: 500 });
  }

  if (payload.action.kind === 'undo.reject') {
    return jsonResponse({ undone: false, rejected: true });
  }

  if (payload.action.kind === 'undo.accept') {
    if (!lastMove) {
      return jsonResponse({ error: 'No moves available to undo' }, { status: 409 });
    }
    const targetIndex =
      typeof payload.action.moveIndex === 'number'
        ? payload.action.moveIndex
        : typeof payload.moveIndex === 'number'
          ? payload.moveIndex
          : lastMove.move_index;
    if (!Number.isInteger(targetIndex) || targetIndex < 0) {
      return jsonResponse({ error: 'Invalid move index for undo' }, { status: 400 });
    }
    if (targetIndex > lastMove.move_index) {
      return jsonResponse({ error: 'Move index mismatch' }, { status: 409 });
    }

    const { data: rewindMoves, error: rewindError } = await supabase
      .from('match_moves')
      .select('id, move_index, action, state_snapshot')
      .eq('match_id', match.id)
      .gte('move_index', targetIndex)
      .order('move_index', { ascending: false });

    if (rewindError) {
      console.error('Failed to load moves for undo', rewindError);
      return jsonResponse({ error: 'Unable to load moves to undo' }, { status: 500 });
    }
    if (!Array.isArray(rewindMoves) || rewindMoves.length === 0) {
      return jsonResponse({ error: 'Move to undo not found' }, { status: 404 });
    }

    const targetMove = rewindMoves.find((move) => move.move_index === targetIndex) ?? null;
    if (!targetMove) {
      return jsonResponse({ error: 'Move to undo not found' }, { status: 404 });
    }

    const targetActionKind = (targetMove.action as { kind?: string } | null)?.kind ?? 'santorini.move';
    if (targetActionKind !== 'santorini.move') {
      return jsonResponse({ error: 'Only standard moves can be undone' }, { status: 409 });
    }

    const { data: previousMoves, error: previousError } = await supabase
      .from('match_moves')
      .select('id, move_index, state_snapshot')
      .eq('match_id', match.id)
      .lt('move_index', targetIndex)
      .order('move_index', { ascending: false })
      .limit(1);

    if (previousError) {
      console.error('Failed to load previous move snapshot', previousError);
      return jsonResponse({ error: 'Unable to load previous game state' }, { status: 500 });
    }

    const previousMove = Array.isArray(previousMoves) && previousMoves.length > 0 ? previousMoves[0] : null;
    const deleteIds = rewindMoves.map((move) => move.id);
    const undoClockUpdatedAt = new Date().toISOString();

    if (deleteIds.length === 0) {
      return jsonResponse({ error: 'No moves available to undo' }, { status: 409 });
    }

    const { error: deleteError } = await supabase
      .from('match_moves')
      .delete()
      .in('id', deleteIds);

    if (deleteError) {
      console.error('Failed to delete moves during undo', deleteError);
      return jsonResponse({ error: 'Failed to remove moves' }, { status: 500 });
    }

    const undoUpdatePayload: Record<string, unknown> = { clock_updated_at: undoClockUpdatedAt };
    if (match.status === 'completed' || match.winner_id) {
      undoUpdatePayload.status = 'in_progress';
      undoUpdatePayload.winner_id = null;
    }
    const { error: undoUpdateError } = await supabase
      .from('matches')
      .update(undoUpdatePayload)
      .eq('id', match.id);
    if (undoUpdateError) {
      console.error('Failed to update match during undo', undoUpdateError);
    }

    const restoredSnapshot = (previousMove?.state_snapshot ?? match.initial_state) as SantoriniStateSnapshot;
    match.status = 'in_progress';
    match.winner_id = null;
    match.updated_at = undoClockUpdatedAt;
    match.clock_updated_at = undoClockUpdatedAt;

    updateMatchCacheAfterUndo(
      match.id,
      authContext.userId,
      playerId,
      role,
      match,
      restoredSnapshot,
      previousMove,
    );
    clearIllegalMovePenalties(authContext.userId);

    const removedMoveIndexes = Array.from(
      new Set(rewindMoves.map((move) => Math.trunc(Number(move.move_index)))),
    ).sort((a, b) => a - b);

    return jsonResponse({
      undone: true,
      moveIndex: targetMove.move_index,
      removedMoveIndexes,
      snapshot: restoredSnapshot,
    });
  }

  if (payload.action.kind !== 'santorini.move') {
    return jsonResponse({ error: 'Unsupported action payload' }, { status: 400 });
  }

  if (!Number.isInteger(payload.action.move) || payload.action.move < 0) {
    return jsonResponse({ error: 'Move must be a non-negative integer' }, { status: 400 });
  }

  const moveAction = payload.action as SantoriniMoveAction;

  let engine: SantoriniEngine;
  const expectedMoveIndex = lastMoveIndex + 1;

  try {
    if (lastMoveIndex >= 0) {
      console.log('Building engine from cached snapshot, move_index:', lastMoveIndex);
    } else {
      console.log('Building engine from initial state (first move)');
    }
    engine = SantoriniEngine.fromSnapshot(snapshot);
    console.log('Engine ready - current player:', engine.player, 'next move index:', expectedMoveIndex);
  } catch (error) {
    console.error('Failed to build engine from snapshot', error);
    return jsonResponse({ error: 'Match state snapshot is corrupted' }, { status: 500 });
  }

  console.log('Move index validation - payload:', payload.moveIndex, 'expected:', expectedMoveIndex);
  if (typeof payload.moveIndex === 'number' && payload.moveIndex !== expectedMoveIndex) {
    console.error('Move index mismatch - payload:', payload.moveIndex, 'expected:', expectedMoveIndex);
    return jsonResponse({ error: 'Move index out of sequence' }, { status: 409 });
  }

  const placementContext = engine.getPlacementContext();
  const actingPlayerIndex = placementContext ? placementContext.player : engine.player;
  if (actingPlayerIndex === 0 && role !== 'creator') {
    return jsonResponse({ error: "It is the creator's turn" }, { status: 403 });
  }
  if (actingPlayerIndex === 1 && role !== 'opponent') {
    return jsonResponse({ error: "It is the opponent's turn" }, { status: 403 });
  }

  let applyResult;
  try {
    const validMoveCount = engine.snapshot.validMoves.filter((value) => Boolean(value)).length;
    console.log('Applying move:', moveAction.move, 'for player:', actingPlayerIndex);
    console.log('Engine state before move - player:', engine.player, 'validMoves count:', validMoveCount);
    applyResult = engine.applyMove(moveAction.move);
    console.log('Move applied successfully, winner:', applyResult.winner);
  } catch (error) {
    console.error('Rejected illegal move', error);
    console.error('Move was:', payload.action.move, 'Player:', actingPlayerIndex);
    console.error('Engine player:', engine.player);
    const blocked = recordIllegalMoveAttempt(authContext.userId);
    const status = blocked ? 429 : 422;
    const message = blocked
      ? 'Too many illegal moves detected. Please wait before trying again.'
      : 'Illegal move';
    return jsonResponse({ error: message }, { status });
  }

  const computedClocks = computeServerClocks(match, lastMove, actingPlayerIndex);
  if (computedClocks.clocks) {
    console.log('🕒  Applied clock state', computedClocks.clocks, 'after elapsedMs', computedClocks.elapsedMs);
  }

  const actionRecord: SantoriniMoveAction = {
    kind: 'santorini.move',
    move: moveAction.move,
    by: actingPlayerIndex === 0 ? 'creator' : 'opponent',
    ...(computedClocks.clocks ? { clocks: computedClocks.clocks } : {}),
  };

  const insertPayload = {
    match_id: match.id,
    move_index: expectedMoveIndex,
    player_id: playerId,
    action: actionRecord,
    state_snapshot: applyResult.snapshot,
  };

  const { data: insertedMove, error: insertError } = await supabase
    .from('match_moves')
    .insert(insertPayload)
    .select('*')
    .single();
  console.log(`⏱️ [${(performance.now() - startTime).toFixed(0)}ms] Move inserted`);

  if (insertError || !insertedMove) {
    console.error('Failed to persist move', insertError);
    return jsonResponse({ error: 'Failed to store move' }, { status: 500 });
  }

  clearIllegalMovePenalties(authContext.userId);

  let winnerId: string | null = null;
  if (applyResult.winner === 0) {
    winnerId = match.creator_id;
  } else if (applyResult.winner === 1) {
    winnerId = match.opponent_id;
  }

  const clockUpdatedAt = new Date().toISOString();
  const matchUpdatePayload: Record<string, unknown> = {
    clock_updated_at: clockUpdatedAt,
  };
  if (winnerId) {
    matchUpdatePayload.status = 'completed';
    matchUpdatePayload.winner_id = winnerId;
  } else {
    matchUpdatePayload.status = 'in_progress';
    matchUpdatePayload.winner_id = null;
  }

  const { error: matchUpdateError } = await supabase
    .from('matches')
    .update(matchUpdatePayload)
    .eq('id', match.id);
  if (matchUpdateError) {
    console.error('Failed to update match after move', matchUpdateError);
  } else {
    console.log(`⏱️ [${(performance.now() - startTime).toFixed(0)}ms] Match metadata updated`);
  }

  match.updated_at = clockUpdatedAt;
  match.clock_updated_at = clockUpdatedAt;
  match.status = matchUpdatePayload.status as string;
  match.winner_id = matchUpdatePayload.winner_id as string | null;

  updateMatchCacheAfterMove(
    match.id,
    authContext.userId,
    playerId,
    role,
    match,
    insertedMove,
    applyResult.snapshot,
  );

  try {
    await notifyOpponentOfTurn({
      supabase,
      match,
      actorPlayerId: playerId,
      actorRole: role,
    });
  } catch (error) {
    console.warn('submit-move: failed to dispatch push notification', error);
  }

  console.log(`⏱️ [TOTAL: ${(performance.now() - startTime).toFixed(0)}ms] Request complete`);
  return jsonResponse({ move: insertedMove, snapshot: applyResult.snapshot });
});
