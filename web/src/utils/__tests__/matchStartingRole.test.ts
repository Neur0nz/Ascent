import { describe, expect, it } from 'vitest';
import type { SantoriniStateSnapshot } from '@/types/match';
import { deriveStartingRole } from '@/utils/matchStartingRole';

const createSnapshot = (player: number): SantoriniStateSnapshot => ({
  version: 1,
  player,
  board: Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => [0, 0, 0]),
  ),
  history: [],
  future: [],
  gameEnded: [0, 0],
  validMoves: Array(10).fill(false),
});

describe('deriveStartingRole', () => {
  it('returns creator when the snapshot indicates player 0', () => {
    expect(deriveStartingRole(createSnapshot(0))).toBe('creator');
  });

  it('returns opponent when the snapshot indicates player 1', () => {
    expect(deriveStartingRole(createSnapshot(1))).toBe('opponent');
  });

  it('returns null for unsupported values', () => {
    expect(deriveStartingRole(createSnapshot(2))).toBeNull();
    expect(deriveStartingRole(undefined)).toBeNull();
  });
});
