import type { MatchAction, SantoriniMoveAction } from '@/types/match';

export const isSantoriniMoveAction = (
  action: MatchAction | null | undefined,
): action is SantoriniMoveAction => {
  return Boolean(action && (action as SantoriniMoveAction).kind === 'santorini.move');
};
