import { GAME_CONSTANTS } from './constants';
import { renderCellSvg } from './svg';
import type { SantoriniSnapshot } from '@/lib/santoriniEngine';
import type { MatchRole } from '@/types/match';
import { getPlayerZeroRoleFromSnapshot } from '@/utils/matchAiDepth';

export type BoardCell = {
  worker: number;
  level: number;
  svg: string;
};

const BOARD_SIZE = GAME_CONSTANTS.BOARD_SIZE;
const svgCache = new Map<string, string>();

const getCellSvg = (level: number, worker: number, playerZeroRole: MatchRole): string => {
  const key = `${level}:${worker}:${playerZeroRole}`;
  const cached = svgCache.get(key);
  if (cached) {
    return cached;
  }
  const svg = renderCellSvg({ levels: level, worker }, { playerZeroRole });
  svgCache.set(key, svg);
  return svg;
};

export const createEmptyBoardView = (playerZeroRole: MatchRole = 'creator'): BoardCell[][] => {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({ worker: 0, level: 0, svg: getCellSvg(0, 0, playerZeroRole) })),
  );
};

export const createBoardViewFromSnapshot = (
  snapshot: SantoriniSnapshot,
  options?: { playerZeroRole?: MatchRole },
): BoardCell[][] => {
  const playerZeroRole = options?.playerZeroRole ?? getPlayerZeroRoleFromSnapshot(snapshot);
  return Array.from({ length: BOARD_SIZE }, (_, y) =>
    Array.from({ length: BOARD_SIZE }, (_, x) => {
      const cell = snapshot.board[y][x];
      const worker = cell[0] || 0;
      const level = cell[1] || 0;
      return {
        worker,
        level,
        svg: getCellSvg(level, worker, playerZeroRole),
      };
    }),
  );
};

export const createEmptyMask = (fill = false): boolean[][] =>
  Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(fill));

export const cloneMask = (mask: boolean[][]): boolean[][] => mask.map((row) => row.slice());
