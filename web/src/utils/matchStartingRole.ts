import type { SantoriniStateSnapshot } from '@/types/match';

export type MatchRole = 'creator' | 'opponent';

export function deriveStartingRole(initialState?: SantoriniStateSnapshot | null): MatchRole | null {
  if (!initialState || typeof initialState.player !== 'number') {
    return null;
  }
  if (initialState.player === 0) {
    return 'creator';
  }
  if (initialState.player === 1) {
    return 'opponent';
  }
  return null;
}
