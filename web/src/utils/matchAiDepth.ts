import type { MatchRole, SantoriniStateSnapshot } from '@/types/match';

const DEFAULT_AI_PLAYER_ID = '00000000-0000-0000-0000-00000000a11a';

type MatchLike = {
  ai_depth?: number | null;
  is_ai_match?: boolean;
  opponent_id?: string | null;
  initial_state?: SantoriniStateSnapshot | null;
} | null;

export const getMatchAiDepth = (match?: MatchLike): number | null => {
  if (!match) return null;
  if (typeof match.ai_depth === 'number') {
    return match.ai_depth;
  }
  const metadataDepth = match.initial_state?.metadata?.aiDepth;
  return typeof metadataDepth === 'number' ? metadataDepth : null;
};

export const isAiMatch = (match?: MatchLike): boolean => {
  if (!match) return false;
  if (match.is_ai_match === true) {
    return true;
  }
  if (typeof match.ai_depth === 'number') {
    return true;
  }
  const metadataDepth = match.initial_state?.metadata?.aiDepth;
  if (typeof metadataDepth === 'number') {
    return true;
  }
  if (match.opponent_id) {
    return match.opponent_id === DEFAULT_AI_PLAYER_ID;
  }
  return false;
};

export const getPlayerZeroRoleFromSnapshot = (snapshot?: SantoriniStateSnapshot | null): MatchRole => {
  if (!snapshot) {
    return 'creator';
  }
  const metaRole = snapshot.metadata?.playerZeroRole;
  if (metaRole === 'creator' || metaRole === 'opponent') {
    return metaRole;
  }
  if (typeof snapshot.player === 'number') {
    return snapshot.player === 1 ? 'opponent' : 'creator';
  }
  return 'creator';
};

export const getPlayerZeroRole = (match?: MatchLike): MatchRole => {
  if (!match) return 'creator';
  return getPlayerZeroRoleFromSnapshot(match.initial_state ?? null);
};

export const getOppositeRole = (role: MatchRole): MatchRole => {
  return role === 'creator' ? 'opponent' : 'creator';
};

export const getRoleForMoveIndex = (moveIndex: number, playerZeroRole: MatchRole): MatchRole => {
  if (!Number.isFinite(moveIndex)) {
    return playerZeroRole;
  }
  const normalizedIndex = Math.max(0, Math.trunc(moveIndex));
  return normalizedIndex % 2 === 0 ? playerZeroRole : getOppositeRole(playerZeroRole);
};
