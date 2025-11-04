import { GAME_CONSTANTS } from '@game/constants';
import { SANTORINI_CONSTANTS } from '@/lib/santoriniEngine';

/**
 * Lightweight helpers shared by the practice hook when it needs to reason
 * about board payloads coming from the Python bridge. Keeping them here keeps
 * `useSantorini` focused on React state instead of array shuffling.
 */

const COLUMN_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;

const inBounds = (y: number, x: number): boolean =>
  y >= 0 && y < GAME_CONSTANTS.BOARD_SIZE && x >= 0 && x < GAME_CONSTANTS.BOARD_SIZE;

export const formatCoordinate = (position?: [number, number] | null): string => {
  if (!position) return '—';
  const [y, x] = position;
  if (!inBounds(y, x)) return '—';
  return `${COLUMN_LABELS[x]}${y + 1}`;
};

export const normalizeBoardPayload = (payload: unknown): number[][][] | null => {
  if (!Array.isArray(payload) || payload.length !== GAME_CONSTANTS.BOARD_SIZE) {
    return null;
  }
  return payload.map((row) => {
    if (!Array.isArray(row) || row.length !== GAME_CONSTANTS.BOARD_SIZE) {
      return Array.from({ length: GAME_CONSTANTS.BOARD_SIZE }, () => [0, 0, 0]);
    }
    return row.map((cell) => {
      if (Array.isArray(cell) && cell.length >= 2) {
        const worker = Number(cell[0]) || 0;
        const level = Number(cell[1]) || 0;
        const meta = Number(cell[2]) || 0;
        return [worker, level, meta];
      }
      return [0, 0, 0];
    });
  });
};

export const cloneBoardGrid = (board: number[][][]): number[][][] =>
  board.map((row) => row.map((cell) => cell.slice() as number[]));

export const findWorkerPosition = (board: number[][][], workerId: number): [number, number] | null => {
  for (let y = 0; y < GAME_CONSTANTS.BOARD_SIZE; y += 1) {
    for (let x = 0; x < GAME_CONSTANTS.BOARD_SIZE; x += 1) {
      if (board[y][x][0] === workerId) {
        return [y, x];
      }
    }
  }
  return null;
};

export const nextPlacementWorkerId = (player: number, board: number[][][]): number => {
  const ids = player === 0 ? [1, 2] : [-1, -2];
  for (const id of ids) {
    if (!board.some((row) => row.some((cell) => cell[0] === id))) {
      return id;
    }
  }
  return ids[0];
};

export const applyActionToBoard = (
  board: number[][][] | null,
  player: number,
  action: number | null,
): number[][][] | null => {
  if (!board) return null;
  const next = cloneBoardGrid(board);
  if (!Number.isInteger(action) || action === null) {
    return next;
  }
  if (action >= 0 && action < GAME_CONSTANTS.BOARD_SIZE * GAME_CONSTANTS.BOARD_SIZE) {
    const targetY = Math.floor(action / GAME_CONSTANTS.BOARD_SIZE);
    const targetX = action % GAME_CONSTANTS.BOARD_SIZE;
    if (inBounds(targetY, targetX)) {
      const workerId = nextPlacementWorkerId(player, board);
      next[targetY][targetX][0] = workerId;
    }
    return next;
  }
  const [workerIndex, _power, moveDirection, buildDirection] = SANTORINI_CONSTANTS.decodeAction(action);
  const workerId = (workerIndex + 1) * (player === 0 ? 1 : -1);
  const origin = findWorkerPosition(next, workerId);
  if (!origin) {
    return next;
  }
  next[origin[0]][origin[1]][0] = 0;
  const moveDelta = SANTORINI_CONSTANTS.DIRECTIONS[moveDirection];
  const destination: [number, number] = [origin[0] + moveDelta[0], origin[1] + moveDelta[1]];
  if (inBounds(destination[0], destination[1])) {
    next[destination[0]][destination[1]][0] = workerId;
  }
  if (buildDirection !== SANTORINI_CONSTANTS.NO_BUILD && inBounds(destination[0], destination[1])) {
    const buildDelta = SANTORINI_CONSTANTS.DIRECTIONS[buildDirection];
    const buildTarget: [number, number] = [destination[0] + buildDelta[0], destination[1] + buildDelta[1]];
    if (inBounds(buildTarget[0], buildTarget[1])) {
      next[buildTarget[0]][buildTarget[1]][1] = Math.min(4, next[buildTarget[0]][buildTarget[1]][1] + 1);
    }
  }
  return next;
};
