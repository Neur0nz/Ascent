import type { MatchRole } from '@/types/match';

/**
 * Convert a Player 0–oriented evaluation value into the creator's perspective.
 * When Player 0 maps to the opponent (creator starts second), the value should be flipped.
 */
export const orientEvaluationToCreator = (
  value: number | null | undefined,
  playerZeroRole: MatchRole,
): number | null => {
  if (!Number.isFinite(value as number)) {
    return null;
  }
  const numeric = Number(value);
  return playerZeroRole === 'creator' ? numeric : -numeric;
};

