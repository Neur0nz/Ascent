import { AbstractGame, type GameInitTuple } from './abstractGame';
import { applyDirection, decodeMove } from './utils';
import { GAME_CONSTANTS } from './constants';

function toPlain<T>(value: T): T {
  if (value && typeof value === 'object') {
    const candidate = value as unknown as { toJs?: (options?: { create_proxies?: boolean }) => unknown };
    if (typeof candidate.toJs === 'function') {
      const plain = candidate.toJs({ create_proxies: false });
      return toPlain(plain as T);
    }
  }
  return value;
}

export class Santorini extends AbstractGame {
  lastMove: number;
  cellsOfLastMove: Array<[number, number]>;

  constructor() {
    super(null);
    this.validMoves = Array(GAME_CONSTANTS.TOTAL_MOVES).fill(false);
    this.lastMove = -1;
    this.cellsOfLastMove = [];
  }

  setBackend(pyodide: any) {
    this.setPyodide(pyodide);
  }

  post_init_game() {
    this.lastMove = -1;
    this.cellsOfLastMove = [];
  }

  pre_move(action: number, manualMove: boolean) {
    if (manualMove) {
      this.cellsOfLastMove = [];
    } else {
      this.updateLastCells(action);
    }
    this.lastMove = action;
  }

  post_set_data() {
    this.lastMove = -1;
    this.cellsOfLastMove = [];
  }

  has_changed_on_last_move(itemVector: [number, number]) {
    return this.cellsOfLastMove.some((entry) => entry[0] === itemVector[0] && entry[1] === itemVector[1]);
  }

  private updateLastCells(action: number) {
    const [worker, moveDirection, buildDirection] = decodeMove(action);
    const workerId = (worker + 1) * (this.nextPlayer === 0 ? 1 : -1);

    if (!this.py || !this.py._findWorker) {
      return;
    }

    const workerPosition = toPlain(this.py._findWorker(workerId));
    if (!Array.isArray(workerPosition) || workerPosition.length < 2) {
      return;
    }
    const [workerY, workerX] = workerPosition as [number, number];
    const [moveY, moveX] = applyDirection(workerY, workerX, moveDirection);
    const [buildY, buildX] = applyDirection(moveY, moveX, buildDirection);
    this.cellsOfLastMove = [
      [workerY, workerX],
      [moveY, moveX],
      [buildY, buildX],
    ];
  }

  editCell(clickedY: number, clickedX: number, editMode: number) {
    if (!this.py || !this.py.editCell) {
      return;
    }
    this.py.editCell(clickedY, clickedX, editMode);
    if (editMode === 0 && typeof this.py.update_after_edit === 'function') {
      const dataTuple = toPlain(this.py.update_after_edit()) as GameInitTuple;
      [this.nextPlayer, this.gameEnded, this.validMoves] = dataTuple;
    }
  }
}
