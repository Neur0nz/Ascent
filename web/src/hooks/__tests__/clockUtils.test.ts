import { describe, expect, it } from 'vitest';
import type { LobbyMatch } from '../useMatchLobby';
import type { MatchMoveRecord, MatchAction, SantoriniMoveAction, SantoriniStateSnapshot } from '@/types/match';
import { computeSynchronizedClock, deriveInitialClocks } from '../clockUtils';

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

  it('falls back to initial clock when no moves exist', () => {
    const now = Date.parse('2024-01-01T00:00:10Z');
    const synced = computeSynchronizedClock(baseMatch, [], 'creator', now);
    expect(synced.creatorMs).toBeLessThan(deriveInitialClocks(baseMatch).creatorMs);
  });
});
