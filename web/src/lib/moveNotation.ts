/**
 * Unified Move Notation System
 *
 * Provides consistent, human-readable move formatting across the entire application.
 * Uses chess-style coordinate notation (A1-E5) as the primary format.
 *
 * Coordinate system:
 * - Columns: A-E (left to right, x = 0 to 4)
 * - Rows: 1-5 (top to bottom, y = 0 to 4)
 *
 * Format: Direction hint only on builds (shows relative direction from landing spot)
 * - Move: coordinates only (A3→B4)
 * - Build: direction + coordinate (↙C4)
 *
 * Examples:
 * - Compact:  "W1: A3→B4, build ↙C4"
 * - Label:    "A3→B4 ↙C4"
 * - Verbose:  "Green Worker 1 moved from A3 to B4 and built at C4"
 * - Placement: "W1 placed A3" or "Green Worker 1 placed at A3"
 */

import { SANTORINI_CONSTANTS } from '@/lib/santoriniEngine';

const { BOARD_SIZE, decodeAction, DIRECTIONS, NO_BUILD } = SANTORINI_CONSTANTS;

// Column labels for chess-style notation
const COLUMN_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;

// Direction symbols for optional display
const DIRECTION_SYMBOLS = ['↖', '↑', '↗', '←', '·', '→', '↙', '↓', '↘'] as const;

/** Check if coordinates are within board bounds */
const inBounds = (y: number, x: number): boolean =>
  y >= 0 && y < BOARD_SIZE && x >= 0 && x < BOARD_SIZE;

/**
 * Format a board position as chess-style coordinate (e.g., "A3", "E5")
 */
export function formatCoordinate(position: [number, number] | null | undefined): string {
  if (!position) return '—';
  const [y, x] = position;
  if (!inBounds(y, x)) return '—';
  return `${COLUMN_LABELS[x]}${y + 1}`;
}

/**
 * Parse a coordinate string back to [y, x] position
 */
export function parseCoordinate(coord: string): [number, number] | null {
  if (!coord || coord.length < 2) return null;
  const col = coord[0].toUpperCase();
  const row = parseInt(coord.slice(1), 10);
  const x = COLUMN_LABELS.indexOf(col as (typeof COLUMN_LABELS)[number]);
  const y = row - 1;
  if (x === -1 || !inBounds(y, x)) return null;
  return [y, x];
}

/**
 * Get direction symbol from direction index
 */
export function getDirectionSymbol(direction: number): string {
  return DIRECTION_SYMBOLS[direction] ?? '·';
}

/**
 * Find a worker's position on the board
 */
export function findWorkerPosition(
  board: number[][][] | null | undefined,
  workerId: number
): [number, number] | null {
  if (!board) return null;
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (board[y]?.[x]?.[0] === workerId) {
        return [y, x];
      }
    }
  }
  return null;
}

/**
 * Apply a direction to a position
 */
function applyDirection(y: number, x: number, direction: number): [number, number] {
  const delta = DIRECTIONS[direction];
  return [y + delta[0], x + delta[1]];
}

// ============================================================================
// Formatting Options
// ============================================================================

export interface MoveFormatOptions {
  /** Include player color prefix (e.g., "Green") */
  includePlayer?: boolean;
  /** Use verbose format with full sentences */
  verbose?: boolean;
  /** Include move index prefix (e.g., "1.") */
  moveIndex?: number;
}

// ============================================================================
// Placement Formatting
// ============================================================================

/**
 * Format a placement action
 *
 * @param action - The placement action (0-24 for board positions)
 * @param player - The player making the placement (0 or 1)
 * @param board - Optional board state to determine which worker is being placed
 * @param options - Formatting options
 *
 * @example
 * formatPlacement(12, 0)                    // "W1 placed C3"
 * formatPlacement(12, 0, board, { verbose: true, includePlayer: true })
 *                                           // "Green Worker 1 placed at C3"
 */
export function formatPlacement(
  action: number,
  player: number,
  board?: number[][][] | null,
  options: MoveFormatOptions = {}
): string {
  const { includePlayer = false, verbose = false, moveIndex } = options;

  const targetY = Math.floor(action / BOARD_SIZE);
  const targetX = action % BOARD_SIZE;
  const coord = formatCoordinate([targetY, targetX]);

  // Determine which worker is being placed
  const workerNum = determineNextWorkerNumber(player, board);
  const workerLabel = verbose ? `Worker ${workerNum}` : `W${workerNum}`;

  const playerLabel = player === 0 ? 'Green' : 'Red';
  const prefix = moveIndex !== undefined ? `${moveIndex}. ` : '';

  if (verbose) {
    const playerPart = includePlayer ? `${playerLabel} ` : '';
    return `${prefix}${playerPart}${workerLabel} placed at ${coord}`;
  }

  const playerPart = includePlayer ? `${playerLabel} ` : '';
  return `${prefix}${playerPart}${workerLabel} placed ${coord}`;
}

/**
 * Determine which worker number (1 or 2) will be placed next
 */
function determineNextWorkerNumber(player: number, board?: number[][][] | null): 1 | 2 {
  if (!board) return 1;

  const workerIds = player === 0 ? [1, 2] : [-1, -2];
  for (let i = 0; i < workerIds.length; i += 1) {
    const workerId = workerIds[i];
    const found = findWorkerPosition(board, workerId);
    if (!found) {
      return (i + 1) as 1 | 2;
    }
  }
  return 1; // Fallback
}

// ============================================================================
// Move Formatting
// ============================================================================

export interface DecodedMove {
  workerIndex: number;
  workerNum: 1 | 2;
  workerId: number;
  moveDirection: number;
  buildDirection: number;
  from: [number, number] | null;
  to: [number, number] | null;
  build: [number, number] | null;
}

/**
 * Decode an action into its components with resolved coordinates
 */
export function decodeMove(
  action: number,
  player: number,
  board?: number[][][] | null
): DecodedMove {
  const [workerIndex, _power, moveDirection, buildDirection] = decodeAction(action);
  const workerId = (workerIndex + 1) * (player === 0 ? 1 : -1);
  const workerNum = (workerIndex + 1) as 1 | 2;

  const from = board ? findWorkerPosition(board, workerId) : null;

  let to: [number, number] | null = null;
  let build: [number, number] | null = null;

  if (from) {
    to = applyDirection(from[0], from[1], moveDirection);
    if (buildDirection !== NO_BUILD && to) {
      build = applyDirection(to[0], to[1], buildDirection);
    }
  }

  return {
    workerIndex,
    workerNum,
    workerId,
    moveDirection,
    buildDirection,
    from,
    to,
    build,
  };
}

/**
 * Format a game move (non-placement)
 *
 * @param action - The move action (>= BOARD_SIZE * BOARD_SIZE)
 * @param player - The player making the move (0 or 1)
 * @param board - Board state BEFORE the move (to find worker positions)
 * @param options - Formatting options
 *
 * @example
 * formatMove(36, 0, board)
 *   // "W1: A3→B4, build ↙C4"
 *
 * formatMove(36, 0, board, { verbose: true, includePlayer: true })
 *   // "Green Worker 1 moved from A3 to B4 and built at C4"
 *
 * formatMove(36, 0, null)  // No board context
 *   // "W1: ↗, build ↙"
 */
export function formatMove(
  action: number,
  player: number,
  board?: number[][][] | null,
  options: MoveFormatOptions = {}
): string {
  const { includePlayer = false, verbose = false, moveIndex } = options;

  // Handle placement actions
  if (action >= 0 && action < BOARD_SIZE * BOARD_SIZE) {
    return formatPlacement(action, player, board, options);
  }

  const decoded = decodeMove(action, player, board);
  const { workerNum, moveDirection, buildDirection, from, to, build } = decoded;

  const playerLabel = player === 0 ? 'Green' : 'Red';
  const prefix = moveIndex !== undefined ? `${moveIndex}. ` : '';

  // If we have board context, use coordinate-based format
  if (from && to) {
    const fromCoord = formatCoordinate(from);
    const toCoord = formatCoordinate(to);
    const buildCoord = build ? formatCoordinate(build) : null;
    const buildDir = buildDirection !== NO_BUILD ? getDirectionSymbol(buildDirection) : null;

    if (verbose) {
      const playerPart = includePlayer ? `${playerLabel} ` : '';
      const workerLabel = `Worker ${workerNum}`;
      const buildPart = buildCoord ? ` and built at ${buildCoord}` : '';
      return `${prefix}${playerPart}${workerLabel} moved from ${fromCoord} to ${toCoord}${buildPart}`;
    }

    // Compact format: coordinates for move, direction+coordinate for build
    const workerPart = includePlayer ? `${playerLabel} W${workerNum}` : `W${workerNum}`;
    const movePart = `${fromCoord}→${toCoord}`;
    // Build shows direction hint (relative to landing spot) + coordinate
    const buildPart = buildCoord && buildDir ? `, build ${buildDir}${buildCoord}` : '';

    return `${prefix}${workerPart}: ${movePart}${buildPart}`;
  }

  // Fallback: direction-based format when no board context
  const moveDir = getDirectionSymbol(moveDirection);
  const buildDir = buildDirection !== NO_BUILD ? getDirectionSymbol(buildDirection) : null;

  if (verbose) {
    const playerPart = includePlayer ? `${playerLabel} ` : '';
    const workerLabel = `Worker ${workerNum}`;
    const buildPart = buildDir ? ` and built ${buildDir}` : '';
    return `${prefix}${playerPart}${workerLabel} moved ${moveDir}${buildPart}`;
  }

  const workerPart = includePlayer ? `${playerLabel} W${workerNum}` : `W${workerNum}`;
  const buildPart = buildDir ? `, build ${buildDir}` : '';
  return `${prefix}${workerPart}: ${moveDir}${buildPart}`;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Format a move for display in move history lists
 * Uses coordinate notation with player prefix
 */
export function formatMoveForHistory(
  action: number,
  player: number,
  board: number[][][] | null,
  moveIndex: number
): string {
  return formatMove(action, player, board, {
    moveIndex,
    includePlayer: false,
    verbose: false,
  });
}

/**
 * Format a move for verbose description (tooltips, details)
 */
export function formatMoveVerbose(
  action: number,
  player: number,
  board: number[][][] | null
): string {
  return formatMove(action, player, board, {
    includePlayer: true,
    verbose: true,
  });
}

/**
 * Format a move for best-moves list (may not have board context)
 * Falls back to direction-based if no board available
 */
export function formatMoveForEvaluation(
  action: number,
  player: number,
  board?: number[][][] | null
): string {
  return formatMove(action, player, board, {
    includePlayer: false,
    verbose: false,
  });
}

/**
 * Format just the move label (for compact lists)
 * Example: "A3→B4 ↙C4" or "W1 placed A3"
 */
export function formatMoveLabel(
  action: number,
  player: number,
  board?: number[][][] | null
): string {
  // Handle placement
  if (action >= 0 && action < BOARD_SIZE * BOARD_SIZE) {
    const targetY = Math.floor(action / BOARD_SIZE);
    const targetX = action % BOARD_SIZE;
    const coord = formatCoordinate([targetY, targetX]);
    const workerNum = determineNextWorkerNumber(player, board);
    return `W${workerNum} placed ${coord}`;
  }

  const decoded = decodeMove(action, player, board);
  const { from, to, build, moveDirection, buildDirection } = decoded;

  if (from && to) {
    const fromCoord = formatCoordinate(from);
    const toCoord = formatCoordinate(to);
    const buildCoord = build ? formatCoordinate(build) : null;
    const buildDir = buildDirection !== NO_BUILD ? getDirectionSymbol(buildDirection) : null;
    // Build shows direction (relative to landing spot) + coordinate
    const buildPart = buildCoord && buildDir ? ` ${buildDir}${buildCoord}` : '';
    return `${fromCoord}→${toCoord}${buildPart}`;
  }

  // Fallback without board: direction-only format
  const moveDir = getDirectionSymbol(moveDirection);
  const buildDir = buildDirection !== NO_BUILD ? ` ${getDirectionSymbol(buildDirection)}` : '';
  return `${moveDir}${buildDir}`;
}

