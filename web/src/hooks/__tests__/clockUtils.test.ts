import { describe, expect, it } from 'vitest';
import type { LobbyMatch } from '../useMatchLobby';
import type { MatchMoveRecord, MatchAction, SantoriniMoveAction, SantoriniStateSnapshot } from '@/types/match';
import { computeSynchronizedClock, deriveInitialClocks, getIncrementMs } from '../clockUtils';

const emptySnapshot: SantoriniStateSnapshot = {
  version: 1,
  player: 0,
  board: Array.from({ length: 5 }, (_, y) =>
    Array.from({ length: 5 }, (_, x) => [0, 0, y === 0 && x === 0 ? 0 : 0]),
  ),
  history: [],
  future: [],
  gameEnded: [0, 0],
  validMoves: Array(162).fill(false),
};

const baseMatch: LobbyMatch = {
  id: 'match-1',
  creator_id: 'creator',
  opponent_id: 'opponent',
  status: 'in_progress',
  visibility: 'private',
  created_at: new Date('2024-01-01T00:00:00Z').toISOString(),
  updated_at: new Date('2024-01-01T00:00:00Z').toISOString(),
  clock_initial_seconds: 300,
  clock_increment_seconds: 5,
  clock_updated_at: null,
  initial_state: emptySnapshot,
  winner_id: null,
  rematch_parent_id: null,
  rated: false,
  creator: null,
  opponent: null,
  private_join_code: null,
  is_ai_match: false,
  ai_depth: null,
};

describe('clockUtils', () => {
  it('derives initial clocks when match has no timer', () => {
    const match = { ...baseMatch, clock_initial_seconds: 0 };
    expect(deriveInitialClocks(match)).toEqual({ creatorMs: 0, opponentMs: 0 });
  });

  it('syncs clock using latest move payload and elapsed time for active role', () => {
    const match: LobbyMatch = {
      ...baseMatch,
      clock_updated_at: '2024-01-01T00:05:00Z',
      updated_at: '2024-01-01T00:05:00Z',
    };
    const moves: MatchMoveRecord<MatchAction>[] = [
      {
        id: 'move-1',
        match_id: match.id,
        move_index: 0,
        player_id: match.creator_id,
        created_at: '2024-01-01T00:05:00Z',
        action: {
          kind: 'santorini.move',
          move: 10,
          by: 'creator',
          clocks: { creatorMs: 120000, opponentMs: 180000 },
        } as SantoriniMoveAction,
        state_snapshot: emptySnapshot,
        eval_snapshot: null,
      },
    ];
    const now = new Date('2024-01-01T00:05:30Z').getTime();
    const synced = computeSynchronizedClock(match, moves, 'opponent', now);
    expect(synced.creatorMs).toBe(120000);
    expect(synced.opponentMs).toBe(150000);
  });

  it('returns initial clocks when no moves have clock data (placement/pre-game)', () => {
    const now = Date.parse('2024-01-01T00:00:10Z');
    const synced = computeSynchronizedClock(baseMatch, [], 'creator', now);
    // Before any moves carry clock data, return initial values unchanged.
    // The local tick worker handles countdown once the game phase begins.
    const initial = deriveInitialClocks(baseMatch);
    expect(synced.creatorMs).toBe(initial.creatorMs);
    expect(synced.opponentMs).toBe(initial.opponentMs);
  });

  it('keeps full time while waiting for opponent to join', () => {
    const waitingMatch: LobbyMatch = {
      ...baseMatch,
      status: 'waiting_for_opponent',
      updated_at: new Date('2024-01-01T00:00:00Z').toISOString(),
    };
    const now = Date.parse('2024-01-01T00:05:00Z');
    const synced = computeSynchronizedClock(waitingMatch, [], 'creator', now);
    const initial = deriveInitialClocks(waitingMatch).creatorMs;
    expect(synced.creatorMs).toBe(initial);
    expect(synced.opponentMs).toBe(initial);
  });

  it('only adjusts active player clock, inactive clock stays frozen', () => {
    const match: LobbyMatch = {
      ...baseMatch,
      clock_updated_at: '2024-01-01T00:05:00Z',
      updated_at: '2024-01-01T00:05:00Z',
    };
    const moves: MatchMoveRecord<MatchAction>[] = [
      {
        id: 'move-1',
        match_id: match.id,
        move_index: 0,
        player_id: match.creator_id,
        created_at: '2024-01-01T00:05:00Z',
        action: {
          kind: 'santorini.move',
          move: 10,
          by: 'creator',
          clocks: { creatorMs: 120000, opponentMs: 180000 },
        } as SantoriniMoveAction,
        state_snapshot: emptySnapshot,
        eval_snapshot: null,
      },
    ];
    const now = Date.parse('2024-01-01T00:05:30Z');
    // When creator is active, only creator's clock ticks
    const syncedCreator = computeSynchronizedClock(match, moves, 'creator', now);
    expect(syncedCreator.creatorMs).toBe(90000); // 120000 - 30000
    expect(syncedCreator.opponentMs).toBe(180000); // unchanged

    // When opponent is active, only opponent's clock ticks
    const syncedOpponent = computeSynchronizedClock(match, moves, 'opponent', now);
    expect(syncedOpponent.creatorMs).toBe(120000); // unchanged
    expect(syncedOpponent.opponentMs).toBe(150000); // 180000 - 30000
  });

  it('getIncrementMs returns increment in milliseconds', () => {
    // Default match has 5 second increment
    expect(getIncrementMs(baseMatch)).toBe(5000);
  });

  it('getIncrementMs returns 0 when no increment is set', () => {
    const noIncrementMatch = { ...baseMatch, clock_increment_seconds: 0 };
    expect(getIncrementMs(noIncrementMatch)).toBe(0);
  });

  it('getIncrementMs returns 0 for null match', () => {
    expect(getIncrementMs(null)).toBe(0);
  });

  it('properly reads clocks with increment already applied by server', () => {
    // Scenario: Creator made a move, spent 10s thinking, got 5s increment
    // Initial: 300s each
    // After move: creator has 300 - 10 + 5 = 295s, opponent has 300s
    const match: LobbyMatch = {
      ...baseMatch,
      clock_updated_at: '2024-01-01T00:00:10Z',
      updated_at: '2024-01-01T00:00:10Z',
    };
    const moves: MatchMoveRecord<MatchAction>[] = [
      {
        id: 'move-1',
        match_id: match.id,
        move_index: 0,
        player_id: match.creator_id,
        created_at: '2024-01-01T00:00:10Z',
        action: {
          kind: 'santorini.move',
          move: 10,
          by: 'creator',
          // Server applied: initial(300s) - elapsed(10s) + increment(5s) = 295s for creator
          clocks: { creatorMs: 295000, opponentMs: 300000 },
        } as SantoriniMoveAction,
        state_snapshot: emptySnapshot,
        eval_snapshot: null,
      },
    ];
    // Check clocks right after the move (no additional elapsed time)
    const now = Date.parse('2024-01-01T00:00:10Z');
    const synced = computeSynchronizedClock(match, moves, 'opponent', now);
    // Creator's clock should be preserved (295s), opponent's clock hasn't started ticking yet
    expect(synced.creatorMs).toBe(295000);
    expect(synced.opponentMs).toBe(300000);
  });
});
