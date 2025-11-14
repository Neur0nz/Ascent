import type { MatchRole, SantoriniStateSnapshot } from '@/types/match';

export function deriveStartingRole(initialState?: SantoriniStateSnapshot | null): MatchRole | null {
  const metaRole = initialState?.metadata?.playerZeroRole;
  if (metaRole === 'creator' || metaRole === 'opponent') {
    return metaRole;
  }
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
