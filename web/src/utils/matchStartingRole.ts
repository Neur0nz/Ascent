import type { MatchRole, SantoriniStateSnapshot } from '@/types/match';
import { getPlayerZeroRoleFromSnapshot } from './matchAiDepth';

export function deriveStartingRole(initialState?: SantoriniStateSnapshot | null): MatchRole | null {
  if (!initialState) return null;
  return getPlayerZeroRoleFromSnapshot(initialState);
}
