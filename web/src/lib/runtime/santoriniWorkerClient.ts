import type { EnginePreference, SantoriniStateSnapshot } from '@/types/match';
import type { PythonEvalResult, PythonMoveSummary, HistorySnapshotEntry } from '@/lib/pythonBridge/types';

type WorkerRequestType =
  | 'init'
  | 'syncSnapshot'
  | 'exportSnapshot'
  | 'calculateEvaluation'
  | 'listMovesWithAdv'
  | 'guessBestAction'
  | 'getHistorySnapshot'
  | 'getHistoryLength'
  | 'jumpToMoveIndex'
  | 'editCell'
  | 'changeDifficulty';

type WorkerResponse = {
  id: number;
  success: boolean;
  result?: unknown;
  error?: string;
};

export class SantoriniWorkerClient {
  private worker: Worker;
  private nextRequestId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();

  constructor() {
    this.worker = new Worker(new URL('../../workers/santoriniEngine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const { id, success, result, error } = event.data;
      const callbacks = this.pending.get(id);
      if (!callbacks) {
        return;
      }
      this.pending.delete(id);
      if (success) {
        callbacks.resolve(result);
      } else {
        callbacks.reject(new Error(error ?? 'Santorini worker request failed'));
      }
    });
  }

  private call<T>(type: WorkerRequestType, payload: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value: unknown) => resolve(value as T),
        reject: (reason: unknown) => reject(reason),
      });
      this.worker.postMessage({ id, type, payload });
    });
  }

  init(enginePreference: EnginePreference): Promise<void> {
    return this.call<void>('init', { enginePreference });
  }

  syncSnapshot(snapshot: SantoriniStateSnapshot): Promise<{ nextPlayer: number; gameEnded: [number, number]; validMoves: boolean[] } | null> {
    return this.call('syncSnapshot', { snapshot }) as Promise<{ nextPlayer: number; gameEnded: [number, number]; validMoves: boolean[] } | null>;
  }

  exportSnapshot(): Promise<SantoriniStateSnapshot | null> {
    return this.call('exportSnapshot') as Promise<SantoriniStateSnapshot | null>;
  }

  calculateEvaluation(depth?: number | null): Promise<PythonEvalResult | null> {
    return this.call('calculateEvaluation', { depth: depth ?? null }) as Promise<PythonEvalResult | null>;
  }

  listMovesWithAdv(limit: number, depth?: number | null): Promise<PythonMoveSummary[]> {
    return this.call('listMovesWithAdv', { limit, depth: depth ?? null }) as Promise<PythonMoveSummary[]>;
  }

  guessBestAction(): Promise<number | null> {
    return this.call('guessBestAction') as Promise<number | null>;
  }

  getHistorySnapshot(): Promise<HistorySnapshotEntry[]> {
    return this.call('getHistorySnapshot') as Promise<HistorySnapshotEntry[]>;
  }

  getHistoryLength(): Promise<number> {
    return this.call('getHistoryLength') as Promise<number>;
  }

  jumpToMoveIndex(index: number): Promise<{ state: { nextPlayer: number; gameEnded: [number, number]; validMoves: boolean[] } | null; snapshot: SantoriniStateSnapshot | null }> {
    return this.call('jumpToMoveIndex', { index }) as Promise<{ state: { nextPlayer: number; gameEnded: [number, number]; validMoves: boolean[] } | null; snapshot: SantoriniStateSnapshot | null }>;
  }

  editCell(y: number, x: number, mode: number): Promise<SantoriniStateSnapshot | null> {
    return this.call('editCell', { y, x, mode }) as Promise<SantoriniStateSnapshot | null>;
  }

  changeDifficulty(numSimulations: number): Promise<void> {
    return this.call('changeDifficulty', { numSimulations });
  }
}
