import type { MatchRole, SantoriniStateSnapshot } from '@/types/match';
import { getPlayerZeroRoleFromSnapshot } from './matchAiDepth';

export function deriveStartingRole(initialState?: SantoriniStateSnapshot | null): MatchRole | null {
  if (!initialState) return null;
  const metaRole = initialState.metadata?.playerZeroRole;
  if (metaRole === 'creator' || metaRole === 'opponent') {
    return metaRole;
  }
  if (initialState.player === 0) {
    return 'creator';
  }
  if (initialState.player === 1) {
    return 'opponent';
  }
  return null;
}
