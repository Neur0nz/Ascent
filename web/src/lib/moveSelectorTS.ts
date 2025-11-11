/**
 * TypeScript Move Selector for Game Phase
 * 
 * Handles the 3-stage move selection:
 * Stage 0: Select worker to move
 * Stage 1: Select where to move
 * Stage 2: Select where to build
 */

import { SANTORINI_CONSTANTS } from './santoriniEngine';

const { decodeAction, encodeAction, DIRECTIONS } = SANTORINI_CONSTANTS;

interface WorkerPosition {
  y: number;
  x: number;
}

function encodeDirection(fromY: number, fromX: number, toY: number, toX: number): number {
  const dy = toY - fromY;
  const dx = toX - fromX;
  
  for (let i = 0; i < DIRECTIONS.length; i++) {
    if (DIRECTIONS[i][0] === dy && DIRECTIONS[i][1] === dx) {
      return i;
    }
  }
  return -1; // Invalid direction
}

export class TypeScriptMoveSelector {
  stage: number = 0;
  workerIndex: number = 0; // 0 or 1 (which of the two workers)
  workerY: number = 0;
  workerX: number = 0;
  moveDirection: number = 0;
  newY: number = 0;
  newX: number = 0;
  buildDirection: number = 0;
  
  constructor() {
    this.reset();
  }
  
  reset() {
    this.stage = 0;
    this.workerIndex = 0;
    this.workerY = 0;
    this.workerX = 0;
    this.moveDirection = 0;
    this.newY = 0;
    this.newX = 0;
    this.buildDirection = 0;
  }
  
  /**
   * Process a cell click and advance to next stage
   * Returns true if click was valid and stage advanced
   */
  click(y: number, x: number, board: number[][][], validMoves: boolean[], currentPlayer: number): boolean {
    if (this.stage === 0) {
      // Stage 0: Select worker
      const worker = board[y][x][0];
      const expectedSign = currentPlayer === 0 ? 1 : -1;
      
      if (Math.sign(worker) !== expectedSign || worker === 0) {
        return false; // Not our worker
      }
      
      this.workerIndex = Math.abs(worker) - 1; // 1 or 2 -> 0 or 1
      this.workerY = y;
      this.workerX = x;
      this.stage = 1;
      return true;
      
    } else if (this.stage === 1) {
      // Allow clicking the same worker again to deselect and return to start
      if (y === this.workerY && x === this.workerX) {
        this.reset();
        return true;
      }

      // Allow switching directly to a different worker that belongs to the player
      const occupant = board[y]?.[x]?.[0] ?? 0;
      const expectedSign = currentPlayer === 0 ? 1 : -1;
      if (occupant !== 0 && Math.sign(occupant) === expectedSign) {
        this.workerIndex = Math.abs(occupant) - 1;
        this.workerY = y;
        this.workerX = x;
        this.moveDirection = 0;
        this.newY = 0;
        this.newX = 0;
        this.buildDirection = 0;
        return true;
      }

      // Stage 1: Select move destination
      this.moveDirection = encodeDirection(this.workerY, this.workerX, y, x);
      
      if (this.moveDirection < 0 || this.moveDirection === 4) {
        // Invalid direction or NO_MOVE
        return false;
      }
      
      // Check if any move+build combination is valid for this move direction
      const hasValidBuild = this.hasValidBuildForMove(validMoves);
      if (!hasValidBuild) {
        return false;
      }
      
      this.newY = y;
      this.newX = x;
      this.stage = 2;
      return true;
      
    } else if (this.stage === 2) {
      // Allow clicking the moved-to position again to cancel and return to start
      if (y === this.newY && x === this.newX) {
        this.reset();
        return true;
      }
      // Allow switching to a different worker even at the build stage
      const occupant = board[y]?.[x]?.[0] ?? 0;
      const expectedSign = currentPlayer === 0 ? 1 : -1;
      const isStartingSquare = y === this.workerY && x === this.workerX;
      if (occupant !== 0 && Math.sign(occupant) === expectedSign && !isStartingSquare) {
        this.workerIndex = Math.abs(occupant) - 1;
        this.workerY = y;
        this.workerX = x;
        this.moveDirection = 0;
        this.newY = 0;
        this.newX = 0;
        this.buildDirection = 0;
        this.stage = 1;
        return true;
      }

      // Stage 2: Select build location
      this.buildDirection = encodeDirection(this.newY, this.newX, y, x);
      
      if (this.buildDirection < 0 || this.buildDirection === 4) {
        // Invalid direction or NO_BUILD
        return false;
      }
      
      const action = encodeAction(this.workerIndex, 0, this.moveDirection, this.buildDirection);
      if (!validMoves[action]) {
        return false; // This specific combination isn't valid
      }
      
      this.stage = 3;
      return true;
    }
    
    return false;
  }
  
  /**
   * Get the encoded action if selection is complete
   * Returns -1 if not complete
   */
  getAction(): number {
    if (this.stage >= 3) {
      return encodeAction(this.workerIndex, 0, this.moveDirection, this.buildDirection);
    }
    return -1;
  }
  
  /**
   * Compute which cells should be highlighted based on current stage
   */
  computeSelectable(board: number[][][], validMoves: boolean[], currentPlayer: number): boolean[][] {
    const selectable: boolean[][] = Array.from({ length: 5 }, () => Array(5).fill(false));
    
    if (this.stage === 0) {
      // Highlight workers that have valid moves
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          const worker = board[y][x][0];
          const expectedSign = currentPlayer === 0 ? 1 : -1;
          
          if (Math.sign(worker) === expectedSign && worker !== 0) {
            const workerIdx = Math.abs(worker) - 1;
            if (this.workerHasValidMoves(workerIdx, validMoves)) {
              selectable[y][x] = true;
            }
          }
        }
      }
      
    } else if (this.stage === 1) {
      // Highlight valid move destinations from current worker
      for (let moveDir = 0; moveDir < 9; moveDir++) {
        if (moveDir === 4) continue; // Skip NO_MOVE
        
        const delta = DIRECTIONS[moveDir];
        const newY = this.workerY + delta[0];
        const newX = this.workerX + delta[1];
        
        if (newY < 0 || newY >= 5 || newX < 0 || newX >= 5) continue;
        
        // Check if any build is valid for this move
        let anyBuildValid = false;
        for (let buildDir = 0; buildDir < 9; buildDir++) {
          if (buildDir === 4) continue; // Skip NO_BUILD
          const action = encodeAction(this.workerIndex, 0, moveDir, buildDir);
          if (validMoves[action]) {
            anyBuildValid = true;
            break;
          }
        }
        
        if (anyBuildValid) {
          selectable[newY][newX] = true;
        }
      }

      // Highlight all friendly workers so the user knows they can reselect
      const expectedSign = currentPlayer === 0 ? 1 : -1;
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          const worker = board[y][x][0];
          if (worker !== 0 && Math.sign(worker) === expectedSign && this.workerHasValidMoves(Math.abs(worker) - 1, validMoves)) {
            selectable[y][x] = true;
          }
        }
      }
      // Always include the currently selected worker
      selectable[this.workerY][this.workerX] = true;
      
    } else if (this.stage === 2) {
      // Highlight valid build locations from new position
      for (let buildDir = 0; buildDir < 9; buildDir++) {
        if (buildDir === 4) continue; // Skip NO_BUILD
        
        const action = encodeAction(this.workerIndex, 0, this.moveDirection, buildDir);
        if (validMoves[action]) {
          const delta = DIRECTIONS[buildDir];
          const buildY = this.newY + delta[0];
          const buildX = this.newX + delta[1];
          
          if (buildY >= 0 && buildY < 5 && buildX >= 0 && buildX < 5) {
            selectable[buildY][buildX] = true;
          }
        }
      }

      // Highlight friendly workers (including the newly moved piece) for reselection
      const expectedSign = currentPlayer === 0 ? 1 : -1;
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          const worker = board[y][x][0];
          if (
            worker !== 0 &&
            Math.sign(worker) === expectedSign &&
            !(y === this.workerY && x === this.workerX) &&
            this.workerHasValidMoves(Math.abs(worker) - 1, validMoves)
          ) {
            selectable[y][x] = true;
          }
        }
      }

      // Also allow clicking the moved-to position to cancel back to start
      selectable[this.newY][this.newX] = true;
    }
    
    return selectable;
  }
  
  /**
   * Check if a worker has any valid moves
   */
  private workerHasValidMoves(workerIdx: number, validMoves: boolean[]): boolean {
    const start = workerIdx * 81; // 81 moves per worker (9 move dirs * 9 build dirs)
    const end = start + 81;
    return validMoves.slice(start, end).some(v => v);
  }
  
  /**
   * Check if current move direction has any valid builds
   */
  private hasValidBuildForMove(validMoves: boolean[]): boolean {
    for (let buildDir = 0; buildDir < 9; buildDir++) {
      if (buildDir === 4) continue;
      const action = encodeAction(this.workerIndex, 0, this.moveDirection, buildDir);
      if (validMoves[action]) {
        return true;
      }
    }
    return false;
  }
}
