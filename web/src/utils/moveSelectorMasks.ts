import { createEmptyMask } from '@game/boardView';
import type { TypeScriptMoveSelector } from '@/lib/moveSelectorTS';

const applyHighlight = (
  mask: boolean[][],
  position: { y: number; x: number } | null,
): void => {
  if (!position) {
    return;
  }
  const { y, x } = position;
  if (y >= 0 && y < mask.length && x >= 0 && x < mask[y].length) {
    mask[y][x] = true;
  }
};

export const createCancelMaskFromSelector = (
  selector: TypeScriptMoveSelector | null,
): boolean[][] => {
  const mask = createEmptyMask();
  if (!selector) {
    return mask;
  }
  const stage = selector.getStage();
  if (stage === 1) {
    applyHighlight(mask, selector.getSelectedWorker());
  } else if (stage === 2) {
    applyHighlight(mask, selector.getMoveDestination());
  }
  return mask;
};
