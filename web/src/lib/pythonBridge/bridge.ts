import type { SantoriniStateSnapshot } from '@/types/match';
import type { HistorySnapshotEntry, PythonEvalResult, PythonMoveSummary } from './types';

type PyProxy = {
  toJs?: (options?: { create_proxies?: boolean }) => unknown;
  destroy?: () => void;
};

function toPlain<T = unknown>(value: T | PyProxy): T {
  if (value && typeof value === 'object') {
    const candidate = value as PyProxy;
    if (typeof candidate.toJs === 'function') {
      const plain = candidate.toJs({ create_proxies: false }) as T;
      candidate.destroy?.();
      return plain;
    }
  }
  return value as T;
}

/**
 * Thin wrapper around the Pyodide Santorini runtime. All Python calls live here so
 * the rest of the app can remain unaware of proxies or Pyodide quirks.
 */
export class SantoriniPythonBridge {
  constructor(private readonly game: { py: Record<string, any> | null }) {}

  private get py(): Record<string, any> {
    if (!this.game.py) {
      throw new Error('Python runtime is not initialized');
    }
    return this.game.py;
  }

  /**
   * Returns the worker + level tuple for a specific cell without exposing raw Py proxies.
   */
  readBoardCell(y: number, x: number): { worker: number; levels: number } {
    const py = this.py;
    return {
      worker: Number(py._read_worker?.(y, x) ?? 0),
      levels: Number(py._read_level?.(y, x) ?? 0),
    };
  }

  /**
   * Pushes the TypeScript snapshot into Python and returns the metadata Python computed.
   */
  importPracticeState(snapshot: SantoriniStateSnapshot): { nextPlayer: number; gameEnded: [number, number]; validMoves: boolean[] } | null {
    const py = this.py;
    if (typeof py.import_practice_state !== 'function') {
      return null;
    }
    const result = toPlain<[number, ArrayLike<number>, ArrayLike<boolean>] | null>(py.import_practice_state(snapshot));
    if (!result || !Array.isArray(result) || result.length < 3) {
      return null;
    }
    const [nextPlayer, endedRaw, validRaw] = result;
    const gameEnded: [number, number] = [
      Number(Array.from(endedRaw ?? [])[0] ?? 0),
      Number(Array.from(endedRaw ?? [])[1] ?? 0),
    ];
    const validMoves = Array.from(validRaw ?? []).map((value) => Boolean(value));
    return { nextPlayer: Number(nextPlayer) || 0, gameEnded, validMoves };
  }

  /**
   * Pulls the current Python practice snapshot for keeping TS in sync.
   */
  exportPracticeState(): SantoriniStateSnapshot | null {
    const py = this.py;
    if (typeof py.export_practice_state !== 'function') {
      return null;
    }
    const snapshot = toPlain<SantoriniStateSnapshot | null>(py.export_practice_state());
    return snapshot ?? null;
  }

  async calculateEvaluation(depthOverride?: number | null): Promise<PythonEvalResult | null> {
    const py = this.py;
    if (typeof py.calculate_eval_for_current_position !== 'function') {
      return null;
    }
    const result = await py.calculate_eval_for_current_position(depthOverride ?? undefined);
    const evaluation = toPlain<number[]>(result);
    return Array.isArray(evaluation) && evaluation.length >= 2 ? { value: evaluation } : null;
  }

  async listCurrentMoves(limit = 10): Promise<PythonMoveSummary[]> {
    const py = this.py;
    if (typeof py.list_current_moves !== 'function') {
      return [];
    }
    const proxy = py.list_current_moves(limit);
    const moves = toPlain<Array<Record<string, unknown>>>(proxy) ?? [];
    return moves
      .map((move) => ({
        action: Number(move.action ?? move.move ?? -1),
        prob: Number(move.prob ?? 0),
        text: typeof move.text === 'string' ? move.text : '',
      }))
      .filter((entry) => Number.isInteger(entry.action) && entry.action >= 0);
  }

  async listMovesWithAdv(limit = 6, depthOverride?: number | null): Promise<PythonMoveSummary[]> {
    const py = this.py;
    if (typeof py.list_current_moves_with_adv !== 'function') {
      return [];
    }
    const proxy = await py.list_current_moves_with_adv(limit, depthOverride ?? undefined);
    const moves = toPlain<Array<Record<string, unknown>>>(proxy) ?? [];
    return moves
      .map((move) => ({
        action: Number(move.action ?? move.move ?? -1),
        prob: Number(move.prob ?? 0),
        text: typeof move.text === 'string' ? move.text : '',
        eval: typeof move.eval === 'number' ? move.eval : undefined,
        delta: typeof move.delta === 'number' ? move.delta : undefined,
      }))
      .filter((entry) => Number.isInteger(entry.action) && entry.action >= 0);
  }

  getHistorySnapshot(): HistorySnapshotEntry[] {
    const py = this.py;
    if (typeof py.get_history_snapshot !== 'function') {
      return [];
    }
    const snapshot = toPlain<Array<Record<string, unknown>>>(py.get_history_snapshot()) ?? [];
    return snapshot.map((entry) => {
      const clone: Record<string, unknown> = {};
      Object.entries(entry).forEach(([key, value]) => {
        clone[key] = toPlain(value);
      });
      return clone as HistorySnapshotEntry;
    });
  }

  getHistoryLength(): number {
    const py = this.py;
    if (typeof py.get_history_length !== 'function') {
      return 0;
    }
    const length = Number(py.get_history_length());
    return Number.isFinite(length) ? Math.max(0, Math.trunc(length)) : 0;
  }

  async guessBestAction(): Promise<number | null> {
    const py = this.py;
    if (typeof py.guessBestAction !== 'function') {
      return null;
    }
    const result = await py.guessBestAction();
    return Number.isFinite(result) ? Number(result) : null;
  }

  jumpToMoveIndex(index: number): { nextPlayer: number; gameEnded: [number, number]; validMoves: boolean[] } | null {
    const py = this.py;
    if (typeof py.jump_to_move_index !== 'function') {
      return null;
    }
    const proxy = py.jump_to_move_index(index);
    const result = toPlain<[number, ArrayLike<number>, ArrayLike<boolean>] | null>(proxy);
    if (!result || !Array.isArray(result) || result.length < 3) {
      return null;
    }
    const [nextPlayer, endRaw, validRaw] = result;
    const gameEnded: [number, number] = [
      Number(Array.from(endRaw ?? [])[0] ?? 0),
      Number(Array.from(endRaw ?? [])[1] ?? 0),
    ];
    const validMoves = Array.from(validRaw ?? []).map((value) => Boolean(value));
    return { nextPlayer: Number(nextPlayer) || 0, gameEnded, validMoves };
  }
}
