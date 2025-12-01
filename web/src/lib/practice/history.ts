import { GAME_CONSTANTS } from '@game/constants';
import { SANTORINI_CONSTANTS } from '@/lib/santoriniEngine';
import {
  applyActionToBoard,
  normalizeBoardPayload,
  findWorkerPosition,
} from '@/lib/practice/practiceEngine';
import { formatMoveVerbose, decodeMove } from '@/lib/moveNotation';

export type MoveSummary = {
  description: string;
  player: number;
  action: number | null;
  phase: 'placement' | 'move' | 'unknown';
  from?: [number, number];
  to?: [number, number];
  build?: [number, number] | null;
  boardBefore?: number[][][] | null;
  boardAfter?: number[][][] | null;
};

/** Formats raw history entries coming back from the Python bridge. */
export function summarizeHistoryEntries(snapshot: Array<Record<string, unknown>>): MoveSummary[] {
  return snapshot.map((entry) => {
    const player = typeof entry.player === 'number' ? entry.player : Number(entry.player) || 0;
    const actionValue = entry.action === null || entry.action === undefined ? null : Number(entry.action);
    const boardBefore = normalizeBoardPayload((entry as Record<string, unknown>).board);
    const boardAfter = applyActionToBoard(boardBefore, player, actionValue);
    const fallbackDescription = typeof entry.description === 'string' ? entry.description : '';

    if (actionValue === null || Number.isNaN(actionValue)) {
      return {
        description: fallbackDescription || 'Initial position',
        player,
        action: null,
        phase: 'unknown',
        boardBefore,
        boardAfter,
      } satisfies MoveSummary;
    }

    // Use unified move notation for description
    const description = formatMoveVerbose(actionValue, player, boardBefore);

    // Placement actions
    if (actionValue >= 0 && actionValue < GAME_CONSTANTS.BOARD_SIZE * GAME_CONSTANTS.BOARD_SIZE) {
      const targetY = Math.floor(actionValue / GAME_CONSTANTS.BOARD_SIZE);
      const targetX = actionValue % GAME_CONSTANTS.BOARD_SIZE;
      return {
        description,
        player,
        action: actionValue,
        phase: 'placement',
        from: undefined,
        to: [targetY, targetX],
        build: null,
        boardBefore,
        boardAfter,
      } satisfies MoveSummary;
    }

    // Regular move actions - decode to get coordinates
    const decoded = decodeMove(actionValue, player, boardBefore);
    const { from, to, build } = decoded;

    return {
      description,
      player,
      action: actionValue,
      phase: 'move',
      from: from ?? undefined,
      to: to ?? undefined,
      build,
      boardBefore,
      boardAfter,
    } satisfies MoveSummary;
  });
}
