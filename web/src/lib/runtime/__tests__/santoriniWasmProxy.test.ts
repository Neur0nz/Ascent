import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initSync, init_panic_hook, SantoriniBoard, SantoriniMcts } from '@wasm/santorini_wasm';
import { SantoriniWasmProxy } from '@/lib/runtime/santoriniWasmProxy';
import { SANTORINI_CONSTANTS, type SantoriniSnapshot } from '@/lib/santoriniEngine';

const { BOARD_SIZE, ACTION_SIZE, encodeAction } = SANTORINI_CONSTANTS;

const createEmptyBoard = (): number[][][] =>
  Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => [0, 0, 0]),
  );

type MateFixture = {
  snapshot: SantoriniSnapshot;
  mateAction: number;
};

const createMateInOneFixture = (): MateFixture => {
  const board = createEmptyBoard();

  // Green workers (player 0)
  board[4][0] = [1, 0, 0];
  board[4][4] = [2, 0, 0];

  // Red workers (player 1)
  board[2][1] = [-1, 2, 0]; // Ready to climb to level 3
  board[0][0] = [-2, 0, 0];

  // Tower the red worker will climb onto this turn
  board[2][2][1] = 3;

  // Allow the winning move to complete with a valid build afterwards
  board[1][2][1] = 1;

  const mateAction = encodeAction(
    0, // red worker -1
    0,
    5, // move east onto the level-3 tower
    1, // build to the north afterwards
  );

  const snapshot: SantoriniSnapshot = {
    version: 1,
    player: 1, // red to move
    board,
    history: [],
    future: [],
    gameEnded: [0, 0],
    validMoves: Array.from({ length: ACTION_SIZE }, () => false),
  };

  return { snapshot, mateAction };
};

beforeAll(() => {
  if (!globalThis.crypto) {
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
  }
  const wasmPath = resolve(process.cwd(), '../rust-wasm/pkg/santorini_wasm_bg.wasm');
  const wasmBytes = readFileSync(wasmPath);
  initSync({ module: wasmBytes });
  init_panic_hook();
});

describe('SantoriniWasmProxy evaluation', () => {
  it('returns negative value for player 0 when red is to move', async () => {
    const { snapshot, mateAction } = createMateInOneFixture();

    const predictor = async () => {
      const pi = new Array<number>(ACTION_SIZE).fill(0);
      pi[mateAction] = 1;
      return { pi, v: 0.42 };
    };

    const proxy = new SantoriniWasmProxy({
      BoardCtor: SantoriniBoard,
      MctsCtor: SantoriniMcts,
      predictor,
      initialSimulations: 200,
    });

    proxy.import_practice_state(snapshot);

    const evaluation = await proxy.calculate_eval_for_current_position(10);
    expect(evaluation[0]).toBeLessThan(-0.8);
    expect(evaluation[1]).toBeGreaterThan(0.8);

    const moves = proxy.list_current_moves();
    expect(moves).not.toHaveLength(0);
    expect(moves[0]?.action).toBe(mateAction);
  });
});
