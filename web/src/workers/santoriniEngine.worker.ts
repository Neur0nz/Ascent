import { createSantoriniRuntime, resetSantoriniRuntimeCache } from '@/lib/runtime/santoriniRuntime';
import { SantoriniPythonBridge } from '@/lib/pythonBridge/bridge';
import type { EnginePreference, SantoriniStateSnapshot } from '@/types/match';
import type { PythonEvalResult, PythonMoveSummary } from '@/lib/pythonBridge/types';

interface InitPayload {
  enginePreference: EnginePreference;
}

interface SyncSnapshotPayload {
  snapshot: SantoriniStateSnapshot;
}

interface JumpToMovePayload {
  index: number;
}

interface EditCellPayload {
  y: number;
  x: number;
  mode: number;
}

interface ListMovesPayload {
  limit: number;
  depth?: number | null;
}

interface EvaluationPayload {
  depth?: number | null;
}

interface ChangeDifficultyPayload {
  numSimulations: number;
}

type WorkerRequest =
  | { id: number; type: 'init'; payload: InitPayload }
  | { id: number; type: 'syncSnapshot'; payload: SyncSnapshotPayload }
  | { id: number; type: 'exportSnapshot'; payload: Record<string, never> }
  | { id: number; type: 'calculateEvaluation'; payload: EvaluationPayload }
  | { id: number; type: 'cancelEvaluation'; payload: Record<string, never> }
  | { id: number; type: 'listMovesWithAdv'; payload: ListMovesPayload }
  | { id: number; type: 'guessBestAction'; payload: Record<string, never> }
  | { id: number; type: 'getHistorySnapshot'; payload: Record<string, never> }
  | { id: number; type: 'getHistoryLength'; payload: Record<string, never> }
  | { id: number; type: 'jumpToMoveIndex'; payload: JumpToMovePayload }
  | { id: number; type: 'editCell'; payload: EditCellPayload }
  | { id: number; type: 'changeDifficulty'; payload: ChangeDifficultyPayload };

type WorkerResponse =
  | { id: number; success: true; result?: unknown }
  | { id: number; success: false; error: string };
let bridge: SantoriniPythonBridge | null = null;
let enginePreference: EnginePreference = 'rust';

type EvalController = { cancelled: boolean };
const workerGlobal = self as typeof self & { __santoriniEvalController?: EvalController };
let activeEvalController: EvalController | null = null;

function assertBridge(): SantoriniPythonBridge {
  if (!bridge) {
    throw new Error('Santorini runtime is not initialized yet');
  }
  return bridge;
}

function beginEvaluationController(): EvalController {
  if (activeEvalController) {
    activeEvalController.cancelled = true;
  }
  const controller: EvalController = { cancelled: false };
  workerGlobal.__santoriniEvalController = controller;
  activeEvalController = controller;
  return controller;
}

function cancelEvaluationController(): void {
  if (activeEvalController) {
    activeEvalController.cancelled = true;
  }
}

function clearEvaluationController(): void {
  cancelEvaluationController();
  delete workerGlobal.__santoriniEvalController;
  activeEvalController = null;
}

async function ensureRuntime(preference: EnginePreference): Promise<void> {
  if (bridge && preference === enginePreference) {
    return;
  }
  clearEvaluationController();
  bridge = null;
  resetSantoriniRuntimeCache();
  const runtime = await createSantoriniRuntime({ evaluationEnabled: true, enginePreference: preference });
  const nextBridge = new SantoriniPythonBridge(runtime.game);
  runtime.game.init_game();
  bridge = nextBridge;
  enginePreference = preference;
}

async function handleMessage(event: MessageEvent<WorkerRequest>): Promise<void> {
  const { id, type, payload } = event.data;
  try {
    let result: unknown;
    switch (type) {
      case 'init': {
        await ensureRuntime(payload.enginePreference);
        result = { ok: true };
        break;
      }
      case 'syncSnapshot': {
        const target = assertBridge();
        result = target.importPracticeState(payload.snapshot);
        break;
      }
      case 'exportSnapshot': {
        result = assertBridge().exportPracticeState();
        break;
      }
      case 'calculateEvaluation': {
        beginEvaluationController();
        try {
          const response = await assertBridge().calculateEvaluation(payload.depth ?? undefined);
          result = response;
        } catch (error) {
          if (error instanceof Error && error.message === 'EVAL_CANCELLED') {
            result = { cancelled: true };
          } else {
            throw error;
          }
        } finally {
          clearEvaluationController();
        }
        break;
      }
      case 'cancelEvaluation': {
        cancelEvaluationController();
        result = { ok: true };
        break;
      }
      case 'listMovesWithAdv': {
        const summaries = await assertBridge().listMovesWithAdv(payload.limit, payload.depth ?? undefined);
        result = summaries;
        break;
      }
      case 'guessBestAction': {
        result = await assertBridge().guessBestAction();
        break;
      }
      case 'getHistorySnapshot': {
        result = assertBridge().getHistorySnapshot();
        break;
      }
      case 'getHistoryLength': {
        result = assertBridge().getHistoryLength();
        break;
      }
      case 'jumpToMoveIndex': {
        const bridgeInstance = assertBridge();
        const jumpResult = bridgeInstance.jumpToMoveIndex(payload.index);
        const snapshot = bridgeInstance.exportPracticeState();
        result = { state: jumpResult, snapshot };
        break;
      }
      case 'editCell': {
        const bridgeInstance = assertBridge();
        const py = (bridgeInstance as unknown as { py: Record<string, any> }).py;
        if (!py || typeof py.editCell !== 'function') {
          throw new Error('editCell unsupported by current backend');
        }
        py.editCell(payload.y, payload.x, payload.mode);
        if (typeof py.update_after_edit === 'function') {
          py.update_after_edit();
        }
        const snapshot = bridgeInstance.exportPracticeState();
        result = snapshot;
        break;
      }
      case 'changeDifficulty': {
        const bridgeInstance = assertBridge();
        const py = (bridgeInstance as unknown as { py: Record<string, any> }).py;
        if (py && typeof py.changeDifficulty === 'function') {
          py.changeDifficulty(payload.numSimulations);
        }
        result = { ok: true };
        break;
      }
      default:
        throw new Error(`Unsupported worker request: ${type satisfies never}`);
    }
    postMessage({ id, success: true, result } satisfies WorkerResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
    postMessage({ id, success: false, error: message } satisfies WorkerResponse);
  }
}

self.addEventListener('message', (event) => {
  handleMessage(event);
});
