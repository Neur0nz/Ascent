import { GAME_CONSTANTS } from './constants';
import { renderCellSvg } from './svg';
import type { SantoriniSnapshot } from '@/lib/santoriniEngine';

export type BoardCell = {
  worker: number;
  level: number;
  svg: string;
};

const BOARD_SIZE = GAME_CONSTANTS.BOARD_SIZE;
const svgCache = new Map<string, string>();

const getCellSvg = (level: number, worker: number): string => {
  const key = `${level}:${worker}`;
  const cached = svgCache.get(key);
  if (cached) {
    return cached;
  }
  const svg = renderCellSvg({ levels: level, worker });
  svgCache.set(key, svg);
  return svg;
};

export const createEmptyBoardView = (): BoardCell[][] => {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({ worker: 0, level: 0, svg: getCellSvg(0, 0) })),
  );
};

export const createBoardViewFromSnapshot = (snapshot: SantoriniSnapshot): BoardCell[][] => {
  return Array.from({ length: BOARD_SIZE }, (_, y) =>
    Array.from({ length: BOARD_SIZE }, (_, x) => {
      const cell = snapshot.board[y][x];
      const worker = cell[0] || 0;
      const level = cell[1] || 0;
      return {
        worker,
        level,
        svg: getCellSvg(level, worker),
      };
    }),
  );
};

export const createEmptyMask = (fill = false): boolean[][] =>
  Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(fill));

export const cloneMask = (mask: boolean[][]): boolean[][] => mask.map((row) => row.slice());
