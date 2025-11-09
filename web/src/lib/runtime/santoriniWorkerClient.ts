import type { EnginePreference, SantoriniStateSnapshot } from '@/types/match';
import type { PythonEvalResult, PythonMoveSummary, HistorySnapshotEntry } from '@/lib/pythonBridge/types';
import SantoriniWorker from '@/workers/santoriniEngine.worker?worker&module';

type WorkerRequestType =
  | 'init'
  | 'syncSnapshot'
  | 'exportSnapshot'
  | 'calculateEvaluation'
  | 'cancelEvaluation'
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
    this.worker = new SantoriniWorker({ type: 'module' });
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

  async calculateEvaluation(depth?: number | null): Promise<PythonEvalResult | null> {
    try {
      const response = (await this.call('calculateEvaluation', { depth: depth ?? null })) as (PythonEvalResult & { cancelled?: false }) | { cancelled: true } | null;
      if (response && typeof response === 'object' && 'cancelled' in response) {
        return null;
      }
      return response as PythonEvalResult | null;
    } catch (error) {
      if (error instanceof Error && error.message === 'EVAL_CANCELLED') {
        return null;
      }
      throw error;
    }
  }

  cancelEvaluation(): Promise<void> {
    return this.call('cancelEvaluation');
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

  destroy(): void {
    this.pending.forEach(({ reject }) => reject(new Error('Santorini worker terminated')));
    this.pending.clear();
    this.worker.terminate();
  }
}
