import type { MatchRole } from '@/types/match';
import { getOppositeRole } from './matchAiDepth';

export const getStartingPlayerIndex = (playerZeroRole: MatchRole): 0 | 1 => {
  return playerZeroRole === 'opponent' ? 1 : 0;
};

export const mapPlayerIndexToRole = (
  playerIndex: number,
  playerZeroRole: MatchRole,
): MatchRole => {
  const startingPlayerIndex = getStartingPlayerIndex(playerZeroRole);
  return playerIndex === startingPlayerIndex ? playerZeroRole : getOppositeRole(playerZeroRole);
};
