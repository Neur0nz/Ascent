import type { SantoriniBoard as SantoriniBoardWasm, SantoriniMcts as SantoriniMctsWasm } from '@wasm/santorini_wasm';
import { SANTORINI_CONSTANTS, type SantoriniSnapshot } from '@/lib/santoriniEngine';
import { cloneBoardGrid, normalizeBoardPayload } from '@/lib/practice/practiceEngine';
import { formatMoveForEvaluation } from '@/lib/moveNotation';
import type { SantoriniStateSnapshot } from '@/types/match';

const BOARD_SIZE = SANTORINI_CONSTANTS.BOARD_SIZE;
const ACTION_SIZE = SANTORINI_CONSTANTS.ACTION_SIZE;
const INIT_PLACEMENT_ACTIONS = BOARD_SIZE * BOARD_SIZE;
const DIRECTIONS = SANTORINI_CONSTANTS.DIRECTIONS;
const NO_MOVE = SANTORINI_CONSTANTS.NO_MOVE;
const NO_BUILD = SANTORINI_CONSTANTS.NO_BUILD;

type PredictorFn = (board: Int8Array, validMask: Uint8Array) => Promise<{ pi: number[]; v: number }>;

type HistoryEntry = {
  player: number;
  board: number[][][];
  action: number | null;
};

type RedoEntry = HistoryEntry;

export interface SantoriniWasmProxyOptions {
  BoardCtor: typeof SantoriniBoardWasm;
  MctsCtor: typeof SantoriniMctsWasm;
  predictor: PredictorFn;
  initialSimulations: number;
}

export interface SearchSummary {
  policy: number[];
  q: [number, number];
  visits: number[];
}

function createEmptyBoard(): number[][][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => [0, 0, 0]),
  );
}

function bytesToBoardArray(bytes: ArrayLike<number>): number[][][] {
  const board = createEmptyBoard();
  let cursor = 0;
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      board[y][x][0] = Number(bytes[cursor] ?? 0);
      board[y][x][1] = Number(bytes[cursor + 1] ?? 0);
      board[y][x][2] = Number(bytes[cursor + 2] ?? 0);
      cursor += 3;
    }
  }
  return board;
}

function boardArrayToBytes(board: number[][][]): Int8Array {
  const buffer = new Int8Array(BOARD_SIZE * BOARD_SIZE * 3);
  let cursor = 0;
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const cell = board[y]?.[x];
      buffer[cursor] = Number(cell?.[0] ?? 0);
      buffer[cursor + 1] = Number(cell?.[1] ?? 0);
      buffer[cursor + 2] = Number(cell?.[2] ?? 0);
      cursor += 3;
    }
  }
  return buffer;
}

function cloneBoard(board: number[][][]): number[][][] {
  return board.map((row) => row.map((cell) => cell.slice() as number[]));
}

function serializeHistory(entries: HistoryEntry[]): Array<{ player: number; board: number[][][]; action: number | null }> {
  return entries.map((entry) => ({
    player: entry.player,
    board: cloneBoard(entry.board),
    action: entry.action,
  }));
}

function deserializeHistory(payload: unknown): HistoryEntry[] {
  if (!Array.isArray(payload)) return [];
  const restored: HistoryEntry[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { player?: unknown; board?: unknown; action?: unknown };
    const boardPayload = normalizeBoardPayload(record.board);
    if (!boardPayload) continue;
    restored.push({
      player: Number(record.player ?? 0) || 0,
      board: cloneBoardGrid(boardPayload),
      action: record.action == null ? null : Number(record.action),
    });
  }
  return restored;
}

/**
 * Format a move for display using the unified notation system.
 * Uses coordinate-based format when board context is available.
 */
function moveToString(action: number, player: number, board?: number[][][] | null): string {
  return formatMoveForEvaluation(action, player, board);
}

function computeEndArray(score: number | undefined): [number, number] {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    return [0, 0];
  }
  if (score > 0) return [1, -1];
  if (score < 0) return [-1, 1];
  return [0, 0];
}

function createValidMaskFromBooleans(valid: boolean[]): Uint8Array {
  const mask = new Uint8Array(valid.length);
  for (let i = 0; i < valid.length; i += 1) {
    mask[i] = valid[i] ? 1 : 0;
  }
  return mask;
}

function boolArrayFromMask(mask: Uint8Array): boolean[] {
  return Array.from({ length: mask.length }, (_, i) => mask[i] !== 0);
}

export class SantoriniWasmProxy {
  private readonly BoardCtor: typeof SantoriniBoardWasm;
  private readonly MctsCtor: typeof SantoriniMctsWasm;
  private readonly predictor: PredictorFn;

  private board: SantoriniBoardWasm;
  private boardArray: number[][][];

  private player = 0;
  private history: HistoryEntry[] = [];
  private futureHistory: RedoEntry[] = [];
  private currentEval: [number, number] = [0, 0];
  private lastPolicy: number[] | null = null;

  private mcts!: SantoriniMctsWasm;
  private simulationCount: number;
  private pending: Promise<void> = Promise.resolve();

  constructor(options: SantoriniWasmProxyOptions) {
    this.BoardCtor = options.BoardCtor;
    this.MctsCtor = options.MctsCtor;
    this.predictor = options.predictor;
    this.simulationCount = Math.max(1, Math.trunc(options.initialSimulations) || 128);

    this.board = new this.BoardCtor();
    this.boardArray = bytesToBoardArray(this.board.getState());
    this.rebuildMcts(this.simulationCount);
  }

  dispose(): void {
    this.board.free?.();
    this.mcts.free?.();
    this.history = [];
    this.futureHistory = [];
  }

  private createMctsConfig(simulations: number, overrides?: { dirichlet_weight?: number }) {
    const config = this.MctsCtor.defaultConfig() ?? {};
    config.num_simulations = simulations;
    config.partial_divisor = config.partial_divisor ?? 4;
    config.prob_full_search = 1.0;
    config.forced_playouts = false;
    config.no_mem_optim = false;
    config.dirichlet_weight =
      overrides && typeof overrides.dirichlet_weight === 'number' ? overrides.dirichlet_weight : 0;
    return config;
  }

  private rebuildMcts(simulations?: number): void {
    const target = Math.max(1, Math.trunc(simulations ?? this.simulationCount));
    this.mcts?.free?.();
    const config = this.createMctsConfig(target);
    this.mcts = new this.MctsCtor(config, this.predictor);
    this.simulationCount = target;
  }

  private ensureMcts(simulations?: number): void {
    const target = simulations ?? this.simulationCount;
    if (this.simulationCount === target && this.mcts) {
      return;
    }
    this.rebuildMcts(target);
  }

  private updateBoardState(bytes?: Int8Array): void {
    const buffer = bytes ? new Int8Array(bytes) : new Int8Array(this.board.getState());
    this.board.setState(buffer);
    this.boardArray = bytesToBoardArray(buffer);
  }

  private setBoardFromArray(board: number[][][]): void {
    this.boardArray = cloneBoard(board);
    const bytes = boardArrayToBytes(this.boardArray);
    this.board.setState(bytes);
  }
  private cloneBoardBytes(): Int8Array {
    return new Int8Array(this.board.getState());
  }

  private computeValidMoves(player: number): boolean[] {
    const mask = this.board.validMoves(player);
    return boolArrayFromMask(mask);
  }

  private computeGameEnded(player: number): [number, number] {
    const value = this.board.maybeTerminalScore(player);
    return computeEndArray(value);
  }

  private recordHistoryEntry(action: number | null): void {
    const snapshot = {
      player: this.player,
      board: cloneBoard(this.boardArray),
      action,
    };
    this.history.unshift(snapshot);
  }

  private resetState(resetBoard: boolean): void {
    this.history = [];
    this.futureHistory = [];
    this.currentEval = [0, 0];
    this.lastPolicy = null;
    if (resetBoard) {
      this.board.reset();
      this.boardArray = bytesToBoardArray(this.board.getState());
    }
    this.rebuildMcts(this.simulationCount);
  }

  set_num_simulations(num: number): void {
    const clamped = Math.max(1, Math.trunc(num));
    this.ensureMcts(clamped);
  }

  init_game(numMCTSSims: number): [number, [number, number], boolean[]] {
    this.set_num_simulations(numMCTSSims);
    this.board.reset();
    this.boardArray = bytesToBoardArray(this.board.getState());
    this.rebuildMcts(this.simulationCount);
    this.player = 0;
    this.history = [];
    this.futureHistory = [];
    this.currentEval = [0, 0];
    this.lastPolicy = null;
    const end = this.computeGameEnded(this.player);
    const validMoves = this.computeValidMoves(this.player);
    return [this.player, end, validMoves];
  }

  getNextState(action: number): [number, [number, number], boolean[]] {
    this.futureHistory = [];
    this.recordHistoryEntry(action);

    const nextPlayer = this.board.applyMove(action, this.player);
    this.player = nextPlayer;
    this.boardArray = bytesToBoardArray(this.board.getState());

    const end = this.computeGameEnded(this.player);
    const validMoves = this.computeValidMoves(this.player);
    return [this.player, end, validMoves];
  }

  changeDifficulty(numMCTSSims: number): void {
    this.set_num_simulations(numMCTSSims);
  }

  async guessBestAction(): Promise<number> {
    return this.enqueueAsync(async () => {
      const baseBytes = this.cloneBoardBytes();
      const { policy, q } = await this.runSearch(this.player, { temperature: 1.0, forceFullSearch: true }, baseBytes);
      this.lastPolicy = policy;

      const greenValue = q[0];
      this.currentEval = [greenValue, -greenValue];

      let bestAction = 0;
      let bestProb = -Infinity;
      policy.forEach((prob, index) => {
        if (prob > bestProb) {
          bestProb = prob;
          bestAction = index;
        }
      });
      return bestAction;
    });
  }

  get_current_eval(): [number, number] {
    return [this.currentEval[0], this.currentEval[1]];
  }

  get_state_version(): number {
    return this.history.length;
  }

  async calculate_eval_for_current_position(numMCTSSims?: number): Promise<[number, number]> {
    return this.enqueueAsync(async () => {
      const previous = this.simulationCount;
      if (typeof numMCTSSims === 'number' && numMCTSSims > 0) {
        this.ensureMcts(Math.trunc(numMCTSSims));
      }
      const baseBytes = this.cloneBoardBytes();
      try {
        const { policy, q } = await this.runSearch(
          this.player,
          { temperature: 1.0, forceFullSearch: true },
          baseBytes,
        );
        this.lastPolicy = policy;
        const greenValue = q[0];
        this.currentEval = [greenValue, -greenValue];
        return [this.currentEval[0], this.currentEval[1]];
      } finally {
        if (previous !== this.simulationCount) {
          this.ensureMcts(previous);
        }
      }
    });
  }

  list_current_moves(limit = 10): Array<{ action: number; prob: number; text: string }> {
    if (!this.lastPolicy) return [];
    const currentBoard = this.boardArray;
    return this.lastPolicy
      .map((prob, action) => ({ action, prob }))
      .filter((entry) => entry.prob > 0)
      .sort((a, b) => b.prob - a.prob)
      .slice(0, limit)
      .map(({ action, prob }) => ({
        action,
        prob,
        text: moveToString(action, this.player, currentBoard),
      }));
  }

  async list_current_moves_with_adv(limit = 5, numMCTSSims?: number): Promise<
    Array<{ action: number; prob: number; text: string; eval: number; delta: number }>
  > {
    return this.enqueueAsync(async () => {
      const previous = this.simulationCount;
      if (typeof numMCTSSims === 'number' && numMCTSSims > 0) {
        this.ensureMcts(Math.trunc(numMCTSSims));
      }

      const baseBytes = this.cloneBoardBytes();
      const originalPlayer = this.player;

      try {
        const { policy, q } = await this.runSearch(
          originalPlayer,
          { temperature: 1.0, forceFullSearch: true },
          baseBytes,
        );
        this.lastPolicy = policy;
        const baseEval = q[0];
        this.currentEval = [baseEval, -baseEval];

        const rankedActions = policy
          .map((prob, action) => ({ action, prob }))
          .filter((entry) => entry.prob > 0)
          .sort((a, b) => b.prob - a.prob)
          .slice(0, limit);

        const results = [];
        const currentBoard = this.boardArray;

        for (const { action, prob } of rankedActions) {
          const tempBoard = new this.BoardCtor();
          tempBoard.setState(baseBytes);
          const nextPlayer = tempBoard.applyMove(action, originalPlayer);
          const simulatedBytes = new Int8Array(tempBoard.getState());
          tempBoard.free?.();

          const { q } = await this.runSearch(
            nextPlayer,
            { temperature: 1.0, forceFullSearch: true },
            simulatedBytes,
          );
          const evalAfter = q[0];

          results.push({
            action,
            prob,
            text: moveToString(action, originalPlayer, currentBoard),
            eval: evalAfter,
            delta: evalAfter - baseEval,
          });
        }

        return results;
      } finally {
        if (previous !== this.simulationCount) {
          this.ensureMcts(previous);
        }
      }
    });
  }

  revert_last_move(): [number, [number, number], boolean[], number[]] {
    if (this.history.length === 0) {
      const end = this.computeGameEnded(this.player);
      const valids = this.computeValidMoves(this.player);
      return [this.player, end, valids, []];
    }
    const removed = this.history.shift()!;
    this.futureHistory.unshift(removed);
    this.player = removed.player;
    this.setBoardFromArray(removed.board);
    const end = this.computeGameEnded(this.player);
    const valids = this.computeValidMoves(this.player);
    return [this.player, end, valids, [removed.action ?? -1]];
  }

  revert_to_previous_move(targetPlayer: number | null): [number, [number, number], boolean[], number[]] {
    if (this.history.length === 0) {
      const end = this.computeGameEnded(this.player);
      const valids = this.computeValidMoves(this.player);
      return [this.player, end, valids, []];
    }

    let removed: HistoryEntry[] = [];
    if (targetPlayer == null) {
      removed = this.history.splice(0, 1);
    } else {
      for (let index = 0; index < this.history.length; index += 1) {
        const entry = this.history[index];
        const nextEntry = this.history[index + 1];
        if (entry.player === targetPlayer && (!nextEntry || nextEntry.player !== targetPlayer)) {
          removed = this.history.splice(0, index + 1);
          break;
        }
      }
    }

    if (removed.length === 0) {
      const end = this.computeGameEnded(this.player);
      const valids = this.computeValidMoves(this.player);
      return [this.player, end, valids, []];
    }

    const restore = removed[removed.length - 1];
    this.player = restore.player;
    this.setBoardFromArray(restore.board);

    this.futureHistory = removed.reverse().concat(this.futureHistory);

    const end = this.computeGameEnded(this.player);
    const valids = this.computeValidMoves(this.player);
    const removedActions = removed.map((entry) => entry.action ?? -1);
    return [this.player, end, valids, removedActions];
  }

  jump_to_move_index(index: number): [number, [number, number], boolean[]] | null {
    if (index < 0 || index >= this.history.length) {
      return null;
    }
    const target = this.history[index];
    this.player = target.player;
    this.setBoardFromArray(target.board);
    this.futureHistory = [];
    const end = this.computeGameEnded(this.player);
    const valids = this.computeValidMoves(this.player);
    return [this.player, end, valids];
  }

  redo_next_move(): [number, [number, number], boolean[], number | null, number] {
    if (this.futureHistory.length === 0) {
      const end = this.computeGameEnded(this.player);
      const valids = this.computeValidMoves(this.player);
      return [this.player, end, valids, null, 0];
    }

    const nextState = this.futureHistory.shift()!;
    this.player = nextState.player;
    this.setBoardFromArray(nextState.board);
    this.history.unshift({
      player: this.player,
      board: cloneBoard(this.boardArray),
      action: nextState.action,
    });
    const nextPlayer = this.board.applyMove(nextState.action ?? -1, this.player);
    this.player = nextPlayer;
    this.boardArray = bytesToBoardArray(this.board.getState());
    const end = this.computeGameEnded(this.player);
    const valids = this.computeValidMoves(this.player);
    return [this.player, end, valids, nextState.action ?? null, this.futureHistory.length];
  }

  get_redo_actions(): number[] {
    return this.futureHistory.map((entry) => entry.action ?? -1);
  }

  get_redo_count(): number {
    return this.futureHistory.length;
  }

  get_last_action(): number | null {
    return this.history.length > 0 ? this.history[0].action ?? null : null;
  }

  get_history_length(): number {
    return this.history.length;
  }

  get_history_snapshot(): Array<{ player: number; action: number | null; description: string; board: number[][][] }> {
    return [...this.history]
      .reverse()
      .map((entry) => ({
        player: entry.player,
        action: entry.action ?? null,
        description: entry.action == null ? '' : moveToString(entry.action, entry.player, entry.board),
        board: cloneBoard(entry.board),
      }));
  }

  export_practice_state(): SantoriniStateSnapshot {
    const end = this.computeGameEnded(this.player);
    const validMoves = this.computeValidMoves(this.player);
    return {
      version: 1,
      player: this.player,
      board: cloneBoard(this.boardArray),
      history: serializeHistory(this.history),
      future: serializeHistory(this.futureHistory),
      gameEnded: end,
      validMoves,
    };
  }

  import_practice_state(snapshot: SantoriniStateSnapshot): [number, [number, number], boolean[]] {
    const board = normalizeBoardPayload(snapshot.board);
    if (!board) {
      throw new Error('Malformed board payload');
    }
    this.player = Number(snapshot.player ?? 0) || 0;
    this.setBoardFromArray(board);
    this.history = deserializeHistory(snapshot.history);
    this.futureHistory = deserializeHistory(snapshot.future);
    this.currentEval = [0, 0];
    this.lastPolicy = null;
    const end = this.computeGameEnded(this.player);
    const valids = this.computeValidMoves(this.player);
    return [this.player, end, valids];
  }

  begin_setup(): void {
    this.resetState(true);
    this.player = 0;
  }

  force_guided_setup(green1: [number, number], green2: [number, number], red1: [number, number], red2: [number, number]): [number, [number, number], boolean[]] {
    const placements = [green1, green2, red1, red2];
    const workerIds = [1, 2, -1, -2];

    const seen = new Set<string>();
    for (const coords of placements) {
      const [y, x] = this.normalizeCoordinates(coords);
      const key = `${y},${x}`;
      if (seen.has(key)) {
        throw new Error('All workers must occupy unique tiles during setup');
      }
      seen.add(key);
    }

    this.resetState(true);
    for (let index = 0; index < placements.length; index += 1) {
      const [y, x] = this.normalizeCoordinates(placements[index]!);
      this.boardArray[y][x][0] = workerIds[index]!;
    }
    this.setBoardFromArray(this.boardArray);
    return this.update_after_edit();
  }

  end_setup(): [number, [number, number], boolean[]] {
    const workers = [1, 2, -1, -2];
    const positions = workers.map((worker) => this._findWorker(worker));
    if (positions.some((pos) => pos[0] < 0 || pos[1] < 0)) {
      throw new Error('All four workers must be placed before finalizing setup');
    }
    return this.force_guided_setup(positions[0], positions[1], positions[2], positions[3]);
  }

  editCell(y: number, x: number, mode: number): void {
    if (!Number.isInteger(y) || !Number.isInteger(x)) {
      return;
    }
    if (mode === 1) {
      const level = this.boardArray[y][x][1];
      this.boardArray[y][x][1] = (level + 1) % 5;
    } else if (mode === 2) {
      const worker = this.boardArray[y][x][0];
      if (worker > 0) {
        this.boardArray[y][x][0] = -1;
      } else if (worker < 0) {
        this.boardArray[y][x][0] = 0;
      } else {
        this.boardArray[y][x][0] = 1;
      }
    } else if (mode === 0) {
      const positives: Array<{ y: number; x: number }> = [];
      const negatives: Array<{ y: number; x: number }> = [];
      for (let row = 0; row < BOARD_SIZE; row += 1) {
        for (let col = 0; col < BOARD_SIZE; col += 1) {
          const worker = this.boardArray[row][col][0];
          if (worker > 0) positives.push({ y: row, x: col });
          else if (worker < 0) negatives.push({ y: row, x: col });
        }
      }
      positives.forEach((pos, index) => {
        this.boardArray[pos.y][pos.x][0] = index < 2 ? index + 1 : 0;
      });
      negatives.forEach((pos, index) => {
        this.boardArray[pos.y][pos.x][0] = index < 2 ? -(index + 1) : 0;
      });
    }
    this.setBoardFromArray(this.boardArray);
  }

  update_after_edit(): [number, [number, number], boolean[]] {
    const end = this.computeGameEnded(this.player);
    const valids = this.computeValidMoves(this.player);
    return [this.player, end, valids];
  }

  _findWorker(worker: number): [number, number] {
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        if (this.boardArray[y][x][0] === worker) {
          return [y, x];
        }
      }
    }
    return [-1, -1];
  }

  _read_worker(y: number, x: number): number {
    return this.boardArray[y]?.[x]?.[0] ?? 0;
  }

  _read_level(y: number, x: number): number {
    return this.boardArray[y]?.[x]?.[1] ?? 0;
  }

  private normalizeCoordinates(coords: [number, number] | readonly [number, number] | number[]): [number, number] {
    const y = Number(coords?.[0] ?? 0);
    const x = Number(coords?.[1] ?? 0);
    if (!Number.isInteger(y) || !Number.isInteger(x) || y < 0 || y >= BOARD_SIZE || x < 0 || x >= BOARD_SIZE) {
      throw new Error(`Setup coordinate out of range: (${coords})`);
    }
    return [y, x];
  }

  private async runSearch(
    player: number,
    options: { temperature: number; forceFullSearch: boolean },
    boardBytes?: Int8Array,
  ): Promise<SearchSummary> {
    const bytes = boardBytes ? new Int8Array(boardBytes) : this.cloneBoardBytes();
    const result = await this.mcts.search(bytes, player, options.temperature, options.forceFullSearch);
    const policy: number[] = Array.isArray(result?.policy) ? result.policy.map(Number) : Array(ACTION_SIZE).fill(0);
    const qRaw = Array.isArray(result?.q) ? result.q : [0, 0];
    const q: [number, number] = [Number(qRaw[0] ?? 0), Number(qRaw[1] ?? 0)];
    const visits = Array.isArray(result?.visits) ? result.visits.map((v: unknown) => Number(v ?? 0)) : Array(ACTION_SIZE).fill(0);
    return { policy, q, visits };
  }
  private enqueueAsync<T>(task: () => Promise<T>): Promise<T> {
    const run = this.pending.then(() => task(), () => task());
    this.pending = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

}
