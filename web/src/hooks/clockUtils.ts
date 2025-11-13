import type { LobbyMatch } from './useMatchLobby';
import type { MatchAction, MatchMoveRecord, SantoriniMoveAction } from '@/types/match';

export interface ClockState {
  creatorMs: number;
  opponentMs: number;
}

const MAX_ELAPSED_SAMPLE_MS = 12 * 60 * 60 * 1000; // 12h clamp, matches Supabase function

const sanitizeClockValue = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.round(parsed);
};

const toTimestampMs = (value: unknown): number | null => {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const isSantoriniMoveAction = (action: MatchAction | null | undefined): action is SantoriniMoveAction => {
  return Boolean(action && (action as SantoriniMoveAction).kind === 'santorini.move');
};

export const deriveInitialClocks = (match: LobbyMatch | null): ClockState => {
  if (!match || match.clock_initial_seconds <= 0) {
    return { creatorMs: 0, opponentMs: 0 };
  }
  const baseMs = Math.max(0, Math.round(match.clock_initial_seconds * 1000));
  return { creatorMs: baseMs, opponentMs: baseMs };
};

export const getIncrementMs = (match: LobbyMatch | null): number => {
  if (!match) return 0;
  const incrementSeconds = Number(match.clock_increment_seconds ?? 0);
  if (!Number.isFinite(incrementSeconds) || incrementSeconds <= 0) {
    return 0;
  }
  return Math.max(0, Math.round(incrementSeconds * 1000));
};

const extractLatestServerClock = (
  match: LobbyMatch | null,
  moves: MatchMoveRecord<MatchAction>[],
): ClockState => {
  const fallback = deriveInitialClocks(match);
  for (let i = moves.length - 1; i >= 0; i -= 1) {
    const action = moves[i]?.action;
    if (isSantoriniMoveAction(action) && action.clocks) {
      return {
        creatorMs: sanitizeClockValue(action.clocks.creatorMs, fallback.creatorMs),
        opponentMs: sanitizeClockValue(action.clocks.opponentMs, fallback.opponentMs),
      };
    }
  }
  return fallback;
};

const getReferenceTimestamp = (
  match: LobbyMatch | null,
  moves: MatchMoveRecord<MatchAction>[],
): number | null => {
  const candidates: Array<unknown> = [];
  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null;
  if (lastMove?.created_at) {
    candidates.push(lastMove.created_at);
  }
  if (match?.clock_updated_at) {
    candidates.push(match.clock_updated_at);
  }
  if (match?.updated_at) {
    candidates.push(match.updated_at);
  }
  if (match?.created_at) {
    candidates.push(match.created_at);
  }
  for (const candidate of candidates) {
    const timestamp = toTimestampMs(candidate);
    if (timestamp !== null) {
      return timestamp;
    }
  }
  return null;
};

export const computeSynchronizedClock = (
  match: LobbyMatch | null,
  moves: MatchMoveRecord<MatchAction>[],
  activeRole: 'creator' | 'opponent' | null,
  now: number = Date.now(),
): ClockState => {
  const base = extractLatestServerClock(match, moves);
  if (!match || match.clock_initial_seconds <= 0 || !activeRole) {
    return base;
  }
  const referenceTimestamp = getReferenceTimestamp(match, moves);
  if (referenceTimestamp === null) {
    return base;
  }
  let elapsedMs = Math.max(0, now - referenceTimestamp);
  if (elapsedMs > MAX_ELAPSED_SAMPLE_MS) {
    elapsedMs = MAX_ELAPSED_SAMPLE_MS;
  }
  const adjusted: ClockState = { ...base };
  if (activeRole === 'creator') {
    adjusted.creatorMs = Math.max(0, adjusted.creatorMs - elapsedMs);
  } else if (activeRole === 'opponent') {
    adjusted.opponentMs = Math.max(0, adjusted.opponentMs - elapsedMs);
  }
  return adjusted;
};
