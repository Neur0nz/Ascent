import { describe, it, expect, beforeEach } from 'vitest';
import { TypeScriptMoveSelector } from '../moveSelectorTS';
import { SANTORINI_CONSTANTS } from '@shared/santoriniEngine';

const { DIRECTIONS, encodeAction } = SANTORINI_CONSTANTS;

// Helper to create a test board state
function createEmptyBoard(): number[][][] {
  return Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => [0, 0, 0])
  );
}

// Helper to place workers on board
function placeWorkers(
  board: number[][][],
  workers: { y: number; x: number; id: number }[]
): void {
  for (const { y, x, id } of workers) {
    board[y][x][0] = id;
  }
}

// Helper to set level on board
function setLevel(board: number[][][], y: number, x: number, level: number): void {
  board[y][x][1] = level;
}

// Helper to compute all valid moves for a board state
function computeValidMoves(board: number[][][], player: number): boolean[] {
  const validMoves = Array(162).fill(false) as boolean[];
  const expectedSign = player === 0 ? 1 : -1;
  
  // Find workers for this player
  const workerPositions: { y: number; x: number; idx: number }[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const worker = board[y][x][0];
      if (Math.sign(worker) === expectedSign && worker !== 0) {
        workerPositions.push({ y, x, idx: Math.abs(worker) - 1 });
      }
    }
  }
  
  // For each worker, compute valid moves
  for (const wp of workerPositions) {
    for (let moveDir = 0; moveDir < 9; moveDir++) {
      if (moveDir === 4) continue; // NO_MOVE
      
      const delta = DIRECTIONS[moveDir];
      const newY = wp.y + delta[0];
      const newX = wp.x + delta[1];
      
      // Check if move is valid
      if (newY < 0 || newY >= 5 || newX < 0 || newX >= 5) continue;
      if (board[newY][newX][0] !== 0) continue; // Cell occupied
      const newLevel = board[newY][newX][1];
      const oldLevel = board[wp.y][wp.x][1];
      if (newLevel > oldLevel + 1) continue; // Can't climb more than 1
      if (newLevel > 3) continue; // Can't move to dome
      
      // For each build direction
      for (let buildDir = 0; buildDir < 9; buildDir++) {
        if (buildDir === 4) continue; // NO_BUILD
        
        const buildDelta = DIRECTIONS[buildDir];
        const buildY = newY + buildDelta[0];
        const buildX = newX + buildDelta[1];
        
        // Check if build is valid
        if (buildY < 0 || buildY >= 5 || buildX < 0 || buildX >= 5) continue;
        
        // Can build where worker came from
        const isOriginalPos = buildY === wp.y && buildX === wp.x;
        if (!isOriginalPos) {
          // Check for other occupants or domes
          if (board[buildY][buildX][0] !== 0) continue;
        }
        if (board[buildY][buildX][1] >= 4) continue; // Already dome
        
        const action = encodeAction(wp.idx, 0, moveDir, buildDir);
        validMoves[action] = true;
      }
    }
  }
  
  return validMoves;
}

describe('TypeScriptMoveSelector', () => {
  let selector: TypeScriptMoveSelector;

  beforeEach(() => {
    selector = new TypeScriptMoveSelector();
  });

  describe('Stage 0: Worker Selection', () => {
    it('highlights only workers with valid moves for current player', () => {
      const board = createEmptyBoard();
      // Player 0 has workers 1 and 2 (positive)
      placeWorkers(board, [
        { y: 0, x: 0, id: 1 },
        { y: 0, x: 4, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      const selectable = selector.computeSelectable(board, validMoves, 0);
      
      // Player 0's workers should be highlighted
      expect(selectable[0][0]).toBe(true); // Worker 1
      expect(selectable[0][4]).toBe(true); // Worker 2
      
      // Player 1's workers should NOT be highlighted
      expect(selectable[4][0]).toBe(false);
      expect(selectable[4][4]).toBe(false);
      
      // Empty cells should not be highlighted
      expect(selectable[2][2]).toBe(false);
    });

    it('does not highlight workers with no valid moves (trapped)', () => {
      const board = createEmptyBoard();
      // Place worker 1 surrounded by domes
      placeWorkers(board, [
        { y: 1, x: 1, id: 1 },
        { y: 3, x: 3, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      // Surround worker 1 with domes
      setLevel(board, 0, 0, 4);
      setLevel(board, 0, 1, 4);
      setLevel(board, 0, 2, 4);
      setLevel(board, 1, 0, 4);
      setLevel(board, 1, 2, 4);
      setLevel(board, 2, 0, 4);
      setLevel(board, 2, 1, 4);
      setLevel(board, 2, 2, 4);
      
      const validMoves = computeValidMoves(board, 0);
      const selectable = selector.computeSelectable(board, validMoves, 0);
      
      // Worker 1 is trapped, should not be highlighted
      expect(selectable[1][1]).toBe(false);
      
      // Worker 2 can move, should be highlighted
      expect(selectable[3][3]).toBe(true);
    });

    it('highlights correct workers for player 1', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 0, x: 0, id: 1 },
        { y: 0, x: 4, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 1);
      const selectable = selector.computeSelectable(board, validMoves, 1);
      
      // Player 1's workers (negative) should be highlighted
      expect(selectable[4][0]).toBe(true);
      expect(selectable[4][4]).toBe(true);
      
      // Player 0's workers should NOT be highlighted
      expect(selectable[0][0]).toBe(false);
      expect(selectable[0][4]).toBe(false);
    });
  });

  describe('Stage 1: Move Destination Selection', () => {
    it('highlights valid move destinations after worker selection', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      
      // Select worker at (2, 2)
      const clicked = selector.click(2, 2, board, validMoves, 0);
      expect(clicked).toBe(true);
      expect(selector.getStage()).toBe(1);
      
      const selectable = selector.computeSelectable(board, validMoves, 0);
      
      // All 8 adjacent cells should be selectable
      expect(selectable[1][1]).toBe(true);
      expect(selectable[1][2]).toBe(true);
      expect(selectable[1][3]).toBe(true);
      expect(selectable[2][1]).toBe(true);
      expect(selectable[2][3]).toBe(true);
      expect(selectable[3][1]).toBe(true);
      expect(selectable[3][2]).toBe(true);
      expect(selectable[3][3]).toBe(true);
      
      // Current worker position should also be highlighted (for deselection)
      expect(selectable[2][2]).toBe(true);
    });

    it('does not highlight move destinations blocked by other workers', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 2, x: 3, id: 2 }, // Blocking one adjacent cell
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      
      selector.click(2, 2, board, validMoves, 0);
      const selectable = selector.computeSelectable(board, validMoves, 0);
      
      // Cell (2, 3) is occupied by another worker
      expect(selectable[2][3]).toBe(false);
    });

    it('does not highlight move destinations blocked by height difference', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      // Set adjacent cell to level 2 (worker is at level 0, can't climb 2 levels)
      setLevel(board, 2, 3, 2);
      
      const validMoves = computeValidMoves(board, 0);
      
      selector.click(2, 2, board, validMoves, 0);
      const selectable = selector.computeSelectable(board, validMoves, 0);
      
      // Cell (2, 3) is too high to climb
      expect(selectable[2][3]).toBe(false);
      
      // Other cells should still be selectable
      expect(selectable[2][1]).toBe(true);
    });

    it('allows clicking same worker to deselect', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      
      // Select worker
      selector.click(2, 2, board, validMoves, 0);
      expect(selector.getStage()).toBe(1);
      
      // Click same worker to deselect
      selector.click(2, 2, board, validMoves, 0);
      expect(selector.getStage()).toBe(0);
    });

    it('allows switching to different worker during stage 1', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      
      // Select first worker
      selector.click(2, 2, board, validMoves, 0);
      expect(selector.getStage()).toBe(1);
      
      // Click different worker - should switch to that worker
      const clicked = selector.click(0, 0, board, validMoves, 0);
      expect(clicked).toBe(true);
      expect(selector.getStage()).toBe(1); // Still in stage 1
      
      // Verify it switched to the new worker
      const worker = selector.getSelectedWorker();
      expect(worker).toEqual({ y: 0, x: 0 });
    });
  });

  describe('Stage 2: Build Location Selection', () => {
    it('highlights valid build locations after move selection', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      
      // Select worker at (2, 2)
      selector.click(2, 2, board, validMoves, 0);
      
      // Select move to (2, 3)
      selector.click(2, 3, board, validMoves, 0);
      expect(selector.getStage()).toBe(2);
      
      const selectable = selector.computeSelectable(board, validMoves, 0);
      
      // Can build on all adjacent cells from new position
      expect(selectable[1][2]).toBe(true);
      expect(selectable[1][3]).toBe(true);
      expect(selectable[1][4]).toBe(true);
      expect(selectable[2][2]).toBe(true); // Original position
      expect(selectable[2][4]).toBe(true);
      expect(selectable[3][2]).toBe(true);
      expect(selectable[3][3]).toBe(true);
      expect(selectable[3][4]).toBe(true);
      
      // Current position (after move) should be highlighted for cancel
      expect(selectable[2][3]).toBe(true);
    });

    it('does not highlight build locations blocked by other workers', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 2, x: 4, id: 2 }, // Adjacent to where we'll move
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      
      selector.click(2, 2, board, validMoves, 0);
      selector.click(2, 3, board, validMoves, 0);
      
      const selectable = selector.computeSelectable(board, validMoves, 0);
      
      // Cannot build on (2, 4) because worker 2 is there
      expect(selectable[2][4]).toBe(false);
    });

    it('does not highlight build locations that are domes', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      // Place a dome adjacent to move destination
      setLevel(board, 2, 4, 4);
      
      const validMoves = computeValidMoves(board, 0);
      
      selector.click(2, 2, board, validMoves, 0);
      selector.click(2, 3, board, validMoves, 0);
      
      const selectable = selector.computeSelectable(board, validMoves, 0);
      
      // Cannot build on dome
      expect(selectable[2][4]).toBe(false);
    });

    it('allows clicking move destination to cancel back to stage 0', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      
      selector.click(2, 2, board, validMoves, 0);
      selector.click(2, 3, board, validMoves, 0);
      expect(selector.getStage()).toBe(2);
      
      // Click the move destination to cancel
      selector.click(2, 3, board, validMoves, 0);
      expect(selector.getStage()).toBe(0);
    });
  });

  describe('Complete Move Encoding', () => {
    it('returns correct action after full move selection', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      
      // Worker at (2,2), move right (direction 5), build right (direction 5)
      selector.click(2, 2, board, validMoves, 0); // Select worker 0
      selector.click(2, 3, board, validMoves, 0); // Move to (2,3) - direction 5
      selector.click(2, 4, board, validMoves, 0); // Build at (2,4) - direction 5
      
      const action = selector.getAction();
      expect(action).toBeGreaterThanOrEqual(0);
      
      // Verify the action is valid
      expect(validMoves[action]).toBe(true);
    });

    it('returns -1 before move is complete', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      
      expect(selector.getAction()).toBe(-1);
      
      selector.click(2, 2, board, validMoves, 0);
      expect(selector.getAction()).toBe(-1);
      
      selector.click(2, 3, board, validMoves, 0);
      expect(selector.getAction()).toBe(-1);
    });
  });

  describe('Performance', () => {
    it('computeSelectable runs quickly for stage 0', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 0, x: 0, id: 1 },
        { y: 0, x: 4, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        selector.computeSelectable(board, validMoves, 0);
      }
      const elapsed = performance.now() - start;
      
      // 1000 iterations should complete in under 100ms
      expect(elapsed).toBeLessThan(100);
    });

    it('computeSelectable runs quickly for stage 1', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      selector.click(2, 2, board, validMoves, 0);
      
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        selector.computeSelectable(board, validMoves, 0);
      }
      const elapsed = performance.now() - start;
      
      // 1000 iterations should complete in under 100ms
      expect(elapsed).toBeLessThan(100);
    });

    it('computeSelectable runs quickly for stage 2', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      selector.click(2, 2, board, validMoves, 0);
      selector.click(2, 3, board, validMoves, 0);
      
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        selector.computeSelectable(board, validMoves, 0);
      }
      const elapsed = performance.now() - start;
      
      // 1000 iterations should complete in under 100ms
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('Edge Cases', () => {
    it('handles board edge positions correctly in stage 0', () => {
      const board = createEmptyBoard();
      // Place workers at corners
      placeWorkers(board, [
        { y: 0, x: 0, id: 1 },
        { y: 4, x: 4, id: 2 },
        { y: 0, x: 4, id: -1 },
        { y: 4, x: 0, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      const selectable = selector.computeSelectable(board, validMoves, 0);
      
      // Both workers should be selectable (they have valid moves from corners)
      expect(selectable[0][0]).toBe(true);
      expect(selectable[4][4]).toBe(true);
    });

    it('handles board edge in stage 1 - corner worker', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 0, x: 0, id: 1 },
        { y: 4, x: 4, id: 2 },
        { y: 0, x: 4, id: -1 },
        { y: 4, x: 0, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      selector.click(0, 0, board, validMoves, 0);
      const selectable = selector.computeSelectable(board, validMoves, 0);
      
      // From corner (0,0), only 3 adjacent cells are valid (not out of bounds)
      expect(selectable[0][1]).toBe(true);
      expect(selectable[1][0]).toBe(true);
      expect(selectable[1][1]).toBe(true);
      
      // Out of bounds cells don't exist in selectable array, so no check needed
      // Current position should be highlighted for deselection
      expect(selectable[0][0]).toBe(true);
    });

    it('handles adjacent workers blocking all but one direction', () => {
      const board = createEmptyBoard();
      // Worker 1 at center, surrounded by domes except one opening
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      // Fill adjacent cells with domes leaving only (3,3) open
      setLevel(board, 1, 1, 4);
      setLevel(board, 1, 2, 4);
      setLevel(board, 1, 3, 4);
      setLevel(board, 2, 1, 4);
      setLevel(board, 2, 3, 4);
      setLevel(board, 3, 1, 4);
      setLevel(board, 3, 2, 4);
      // (3,3) is left open
      
      const validMoves = computeValidMoves(board, 0);
      
      // Worker 1 should still be selectable - it can move to (3,3)
      const selectable = selector.computeSelectable(board, validMoves, 0);
      expect(selectable[2][2]).toBe(true);
    });

    it('does not highlight worker that is completely trapped', () => {
      const board = createEmptyBoard();
      // Worker 1 at center, completely surrounded by domes
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      // Fill ALL adjacent cells with domes
      setLevel(board, 1, 1, 4);
      setLevel(board, 1, 2, 4);
      setLevel(board, 1, 3, 4);
      setLevel(board, 2, 1, 4);
      setLevel(board, 2, 3, 4);
      setLevel(board, 3, 1, 4);
      setLevel(board, 3, 2, 4);
      setLevel(board, 3, 3, 4);
      
      const validMoves = computeValidMoves(board, 0);
      
      // Worker 1 is trapped, should not be highlighted
      const selectable = selector.computeSelectable(board, validMoves, 0);
      expect(selectable[2][2]).toBe(false);
      
      // But worker 2 at (0,0) should be highlighted since it can move
      expect(selectable[0][0]).toBe(true);
    });

    it('resets correctly after completing a move', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      
      // Complete a move
      selector.click(2, 2, board, validMoves, 0);
      selector.click(2, 3, board, validMoves, 0);
      selector.click(2, 4, board, validMoves, 0);
      
      expect(selector.getStage()).toBe(3);
      
      // Reset
      selector.reset();
      
      expect(selector.getStage()).toBe(0);
      expect(selector.getAction()).toBe(-1);
    });
  });

  describe('Invalid Click Handling', () => {
    it('returns false when clicking empty cell in stage 0', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 0, x: 0, id: 1 },
        { y: 0, x: 4, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      
      // Click on empty cell
      const clicked = selector.click(2, 2, board, validMoves, 0);
      expect(clicked).toBe(false);
      expect(selector.getStage()).toBe(0);
    });

    it('returns false when clicking opponent worker in stage 0', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 0, x: 0, id: 1 },
        { y: 0, x: 4, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      
      // Click on opponent's worker
      const clicked = selector.click(4, 0, board, validMoves, 0);
      expect(clicked).toBe(false);
      expect(selector.getStage()).toBe(0);
    });

    it('returns false when clicking invalid move destination in stage 1', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 0, x: 0, id: 1 },
        { y: 0, x: 4, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      selector.click(0, 0, board, validMoves, 0);
      
      // Click on a cell not adjacent to worker
      const clicked = selector.click(2, 2, board, validMoves, 0);
      expect(clicked).toBe(false);
      expect(selector.getStage()).toBe(1);
    });

    it('returns false when clicking invalid build location in stage 2', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 4, x: 4, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 0, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      selector.click(2, 2, board, validMoves, 0);
      selector.click(2, 3, board, validMoves, 0);
      
      // Click on an empty cell not adjacent to new position (0,0)
      const clicked = selector.click(0, 0, board, validMoves, 0);
      expect(clicked).toBe(false);
      expect(selector.getStage()).toBe(2);
    });

    it('allows switching to another friendly worker in stage 2', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      selector.click(2, 2, board, validMoves, 0);
      selector.click(2, 3, board, validMoves, 0);
      expect(selector.getStage()).toBe(2);
      
      // Click on another friendly worker - should switch to that worker
      const clicked = selector.click(0, 0, board, validMoves, 0);
      expect(clicked).toBe(true);
      expect(selector.getStage()).toBe(1); // Back to move selection for new worker
      expect(selector.getSelectedWorker()).toEqual({ y: 0, x: 0 });
    });
  });

  describe('Cancel Mask Integration', () => {
    it('getSelectedWorker returns null at stage 0', () => {
      expect(selector.getSelectedWorker()).toBeNull();
    });

    it('getSelectedWorker returns correct position at stage 1', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      selector.click(2, 2, board, validMoves, 0);
      
      expect(selector.getSelectedWorker()).toEqual({ y: 2, x: 2 });
    });

    it('getMoveDestination returns null before stage 2', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      
      expect(selector.getMoveDestination()).toBeNull();
      
      selector.click(2, 2, board, validMoves, 0);
      expect(selector.getMoveDestination()).toBeNull();
    });

    it('getMoveDestination returns correct position at stage 2', () => {
      const board = createEmptyBoard();
      placeWorkers(board, [
        { y: 2, x: 2, id: 1 },
        { y: 0, x: 0, id: 2 },
        { y: 4, x: 0, id: -1 },
        { y: 4, x: 4, id: -2 },
      ]);
      
      const validMoves = computeValidMoves(board, 0);
      selector.click(2, 2, board, validMoves, 0);
      selector.click(2, 3, board, validMoves, 0);
      
      expect(selector.getMoveDestination()).toEqual({ y: 2, x: 3 });
    });
  });
});

