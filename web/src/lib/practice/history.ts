import { GAME_CONSTANTS } from '@game/constants';
import { SANTORINI_CONSTANTS } from '@/lib/santoriniEngine';
import {
  applyActionToBoard,
  formatCoordinate,
  normalizeBoardPayload,
  nextPlacementWorkerId,
  findWorkerPosition,
} from '@/lib/practice/practiceEngine';

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

    if (actionValue >= 0 && actionValue < GAME_CONSTANTS.BOARD_SIZE * GAME_CONSTANTS.BOARD_SIZE) {
      const targetY = Math.floor(actionValue / GAME_CONSTANTS.BOARD_SIZE);
      const targetX = actionValue % GAME_CONSTANTS.BOARD_SIZE;
      const workerId = boardBefore ? nextPlacementWorkerId(player, boardBefore) : player === 0 ? 1 : -1;
      const workerLabel = workerId === 1 || workerId === -1 ? 'Worker 1' : 'Worker 2';
      const playerLabel = player === 0 ? 'Green' : 'Red';
      const description = `${playerLabel} ${workerLabel} placed on ${formatCoordinate([targetY, targetX])}.`;
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

    const [workerIndex, _power, moveDirection, buildDirection] = SANTORINI_CONSTANTS.decodeAction(actionValue);
    const workerId = (workerIndex + 1) * (player === 0 ? 1 : -1);
    const origin = boardBefore ? findWorkerPosition(boardBefore, workerId) ?? undefined : undefined;
    const moveDelta = SANTORINI_CONSTANTS.DIRECTIONS[moveDirection];
    const destination = origin ? ([origin[0] + moveDelta[0], origin[1] + moveDelta[1]] as [number, number]) : undefined;
    const build =
      buildDirection === SANTORINI_CONSTANTS.NO_BUILD || !destination
        ? null
        : ([
            destination[0] + SANTORINI_CONSTANTS.DIRECTIONS[buildDirection][0],
            destination[1] + SANTORINI_CONSTANTS.DIRECTIONS[buildDirection][1],
          ] as [number, number]);
    const workerLabel = workerIndex === 0 ? 'Worker 1' : 'Worker 2';
    const playerLabel = player === 0 ? 'Green' : 'Red';
    const fromLabel = formatCoordinate(origin);
    const toLabel = formatCoordinate(destination);
    const buildLabel = build ? formatCoordinate(build) : null;
    const descriptionParts = [`${playerLabel} ${workerLabel} moved`];
    if (fromLabel !== '—') {
      descriptionParts.push(`from ${fromLabel}`);
    }
    descriptionParts.push(`to ${toLabel}`);
    if (buildLabel && buildLabel !== '—') {
      descriptionParts.push(`and built ${buildLabel}`);
    }
    const description = descriptionParts.join(' ') + '.';
    return {
      description,
      player,
      action: actionValue,
      phase: 'move',
      from: origin,
      to: destination,
      build,
      boardBefore,
      boardAfter,
    } satisfies MoveSummary;
  });
}
