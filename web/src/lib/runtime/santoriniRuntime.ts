import { Santorini } from '@game/santorini';
import { MoveSelector } from '@game/moveSelector';
import { loadExternalScript } from './scriptLoader';
import { SANTORINI_MODEL_URL } from '@/lib/santoriniAssets';
import { SantoriniWasmProxy, type SantoriniWasmProxyOptions } from './santoriniWasmProxy';
import { SANTORINI_CONSTANTS } from '@/lib/santoriniEngine';

type WasmModule = typeof import('@wasm/santorini_wasm.js');

let wasmModulePromise: Promise<WasmModule> | null = null;
let predictorPromise: Promise<(board: Int8Array, mask: Uint8Array) => Promise<{ pi: number[]; v: number }>> | null = null;
let onnxSessionCache: { url: string; session: any } | null = null;

async function ensureWasmModule(): Promise<WasmModule> {
  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      const wasm = await import('@wasm/santorini_wasm.js');
      await wasm.default();
      wasm.init_panic_hook();
      return wasm;
    })();
  }
  return wasmModulePromise;
}

async function ensureOnnxPredictor(): Promise<(board: Int8Array, mask: Uint8Array) => Promise<{ pi: number[]; v: number }>> {
  if (predictorPromise) {
    return predictorPromise;
  }

  predictorPromise = (async () => {
    const onnxUrl = import.meta.env.VITE_ONNX_URL as string | undefined;
    if (!onnxUrl) {
      throw new Error('Missing VITE_ONNX_URL environment variable');
    }

    await loadExternalScript({
      src: onnxUrl,
      integrity: import.meta.env.VITE_ONNX_INTEGRITY,
      crossOrigin: 'anonymous',
    });

    if (!window.ort) {
      throw new Error('ONNX runtime script failed to register window.ort');
    }

    if (!onnxSessionCache || onnxSessionCache.url !== SANTORINI_MODEL_URL) {
      const response = await fetch(SANTORINI_MODEL_URL, { cache: 'force-cache' });
      if (!response.ok) {
        throw new Error(`Unable to download Santorini model (${response.status})`);
      }
      const modelBuffer = await response.arrayBuffer();
      const sessionOptions = {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
        enableCpuMemArena: false,
        enableMemPattern: false,
        enableProfiling: false,
        logLevel: 'warning' as const,
      };
      const session = await window.ort.InferenceSession.create(modelBuffer, sessionOptions);
      onnxSessionCache = { url: SANTORINI_MODEL_URL, session };
    }

    const session = onnxSessionCache.session;
    const BOARD_SIZE = 5 * 5 * 3;
    const OUTPUT_SIZE = SANTORINI_CONSTANTS.ACTION_SIZE;

    return async (boardBytes: Int8Array, validMask: Uint8Array) => {
      const canonical = new Int8Array(boardBytes.length);
      const channelStride = 5 * 5;
      for (let idx = 0; idx < boardBytes.length; idx += 3) {
        canonical[idx] = boardBytes[idx];
        canonical[idx + 1] = boardBytes[idx + 1];
        canonical[idx + 2] = boardBytes[idx + 2];
      }

      const boardData = new Float32Array(BOARD_SIZE);
      for (let i = 0; i < canonical.length && i < BOARD_SIZE; i += 1) {
        boardData[i] = canonical[i];
      }

      const validData = new Uint8Array(validMask.length);
      for (let i = 0; i < validMask.length; i += 1) {
        validData[i] = validMask[i];
      }

      const tensorBoard = new window.ort.Tensor('float32', boardData, [1, 5, 5, 3]);
      const tensorValid = new window.ort.Tensor('bool', validData, [1, OUTPUT_SIZE]);
      const results = await session.run({
        board: tensorBoard,
        valid_actions: tensorValid,
      });
      const pi = Array.from(results.pi.data as Float32Array);
      const vArray = Array.from(results.v.data as Float32Array);
      const v = vArray.length > 0 ? vArray[0] : 0;
      return { pi, v };
    };
  })();

  return predictorPromise;
}

export async function createSantoriniRuntime(_options: { evaluationEnabled: boolean }): Promise<{
  game: Santorini;
  selector: MoveSelector;
}> {
  const wasm = await ensureWasmModule();
  const predictor = await ensureOnnxPredictor();

  const proxyOptions: SantoriniWasmProxyOptions = {
    BoardCtor: wasm.SantoriniBoard,
    MctsCtor: wasm.SantoriniMcts,
    predictor,
    initialSimulations: 25,
  };

  const proxy = new SantoriniWasmProxy(proxyOptions);

  const game = new Santorini();
  game.setBackend(proxy);

  const selector = new MoveSelector(game);

  return { game, selector };
}

export function resetSantoriniRuntimeCache(): void {
  wasmModulePromise = null;
  predictorPromise = null;
  onnxSessionCache = null;
}
