import { Santorini } from '@game/santorini';
import { MoveSelector } from '@game/moveSelector';
import { loadExternalScript } from './scriptLoader';
import { SANTORINI_MODEL_URL } from '@/lib/santoriniAssets';
import { SantoriniWasmProxy, type SantoriniWasmProxyOptions } from './santoriniWasmProxy';
import { SANTORINI_CONSTANTS } from '@/lib/santoriniEngine';
import type { EnginePreference } from '@/types/match';
import gamePy from '@/assets/santorini/Game.py?raw';
import mctsPy from '@/assets/santorini/MCTS.py?raw';
import santoriniConstantsPy from '@/assets/santorini/SantoriniConstants.py?raw';
import santoriniDisplayPy from '@/assets/santorini/SantoriniDisplay.py?raw';
import santoriniGamePy from '@/assets/santorini/SantoriniGame.py?raw';
import santoriniLogicPy from '@/assets/santorini/SantoriniLogicNumba.py?raw';
import proxyPy from '@/assets/santorini/proxy.py?raw';

type WasmModule = typeof import('@wasm/santorini_wasm.js');
type PredictorFn = (board: Int8Array, mask: Uint8Array) => Promise<{ pi: number[]; v: number[] }>;
type RuntimeResult = { game: Santorini; selector: MoveSelector };

const PYTHON_FILES = [
  { filename: 'Game.py', content: gamePy },
  { filename: 'MCTS.py', content: mctsPy },
  { filename: 'SantoriniConstants.py', content: santoriniConstantsPy },
  { filename: 'SantoriniDisplay.py', content: santoriniDisplayPy },
  { filename: 'SantoriniGame.py', content: santoriniGamePy },
  { filename: 'SantoriniLogicNumba.py', content: santoriniLogicPy },
  { filename: 'proxy.py', content: proxyPy },
] as const;

const PYTHON_BOOTSTRAP = `
import sys
import importlib
if '/santorini' not in sys.path:
    sys.path.insert(0, '/santorini')
import proxy as santorini_proxy
importlib.reload(santorini_proxy)
`;

let wasmModulePromise: Promise<WasmModule> | null = null;
let predictorPromise: Promise<PredictorFn> | null = null;
let onnxSessionCache: { url: string; session: any } | null = null;
let pyodidePromise: Promise<any> | null = null;

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

async function ensureOnnxPredictor(): Promise<PredictorFn> {
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
    const BOARD_SIZE = 25 * 3;
    const OUTPUT_SIZE = SANTORINI_CONSTANTS.ACTION_SIZE;

    return async (boardBytes: Int8Array, validMask: Uint8Array) => {
      const boardData = new Float32Array(BOARD_SIZE);
      for (let i = 0; i < boardBytes.length && i < BOARD_SIZE; i += 1) {
        boardData[i] = boardBytes[i];
      }

      const maskData = new Uint8Array(validMask.length);
      for (let i = 0; i < validMask.length; i += 1) {
        maskData[i] = validMask[i];
      }

      const tensorBoard = new window.ort.Tensor('float32', boardData, [1, 25, 3]);
      const tensorValid = new window.ort.Tensor('bool', maskData, [1, OUTPUT_SIZE]);
      const results = await session.run({
        board: tensorBoard,
        valid_actions: tensorValid,
      });
      const pi = Array.from(results.pi.data as Float32Array);
      const rawValues = Array.from(results.v.data as Float32Array);
      const evaluation =
        rawValues.length >= 2
          ? rawValues
          : rawValues.length === 1
            ? [rawValues[0], -rawValues[0]]
            : [0, 0];
      return { pi, v: evaluation };
    };
  })();

  return predictorPromise;
}

function resolvePyodideIndexURL(pyodideUrl: string): string {
  try {
    if (typeof window === 'undefined') {
      return pyodideUrl;
    }
    const base = new URL(pyodideUrl, window.location.href);
    base.search = '';
    base.hash = '';
    base.pathname = base.pathname.replace(/\/[^/]*$/, '/');
    return base.toString();
  } catch {
    const lastSlash = pyodideUrl.lastIndexOf('/');
    if (lastSlash === -1) {
      return pyodideUrl;
    }
    return pyodideUrl.slice(0, lastSlash + 1);
  }
}

async function ensurePyodide(): Promise<any> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      if (typeof window === 'undefined') {
        throw new Error('Santorini Python engine is only available in the browser.');
      }
      const pyodideUrl = import.meta.env.VITE_PYODIDE_URL as string | undefined;
      if (!pyodideUrl) {
        throw new Error('Missing VITE_PYODIDE_URL environment variable');
      }

      await loadExternalScript({
        src: pyodideUrl,
        crossOrigin: 'anonymous',
      });

      if (typeof window.loadPyodide !== 'function') {
        throw new Error('Pyodide script failed to expose loadPyodide');
      }

      const pyodide = await window.loadPyodide({
        indexURL: resolvePyodideIndexURL(pyodideUrl),
        fullStdLib: false,
      });
      await pyodide.loadPackage('numpy');
      return pyodide;
    })();
  }
  return pyodidePromise;
}

function writePythonSources(pyodide: any): void {
  const fs = pyodide.FS;
  const baseDir = '/santorini';
  const dirInfo = fs.analyzePath(baseDir);
  if (!dirInfo.exists) {
    fs.mkdir(baseDir);
  }
  for (const file of PYTHON_FILES) {
    fs.writeFile(`${baseDir}/${file.filename}`, file.content, { encoding: 'utf8' });
  }
}

async function loadPythonModule(pyodide: any) {
  writePythonSources(pyodide);
  await pyodide.runPythonAsync(PYTHON_BOOTSTRAP);
  return pyodide.pyimport('proxy');
}

function installPredictBridge(predictor: PredictorFn): void {
  if (typeof globalThis === 'undefined') {
    return;
  }
  (globalThis as any).predict = async (boardList: ArrayLike<number>, maskList: ArrayLike<number>) => {
    const boardBytes = new Int8Array(boardList.length);
    for (let i = 0; i < boardList.length; i += 1) {
      boardBytes[i] = Number(boardList[i] ?? 0);
    }
    const maskBytes = new Uint8Array(maskList.length);
    for (let i = 0; i < maskList.length; i += 1) {
      maskBytes[i] = Number(maskList[i] ?? 0) ? 1 : 0;
    }
    const result = await predictor(boardBytes, maskBytes);
    const pi = Array.from(result.pi ?? []);
    const rawValues = Array.isArray(result.v) ? result.v.map((entry) => Number(entry) || 0) : [];
    const evaluation =
      rawValues.length >= 2
        ? rawValues
        : rawValues.length === 1
          ? [rawValues[0], -rawValues[0]]
          : [0, 0];
    return {
      pi,
      v: evaluation,
    };
  };
}

async function createPythonRuntime(predictor: PredictorFn): Promise<RuntimeResult> {
  const pyodide = await ensurePyodide();
  const module = await loadPythonModule(pyodide);
  installPredictBridge(predictor);
  const game = new Santorini();
  game.setBackend(module);
  game.init_game();
  const selector = new MoveSelector(game);
  return { game, selector };
}

async function createRustRuntime(predictor: PredictorFn): Promise<RuntimeResult> {
  const wasm = await ensureWasmModule();
  const rustPredictor = async (board: Int8Array, mask: Uint8Array) => {
    const result = await predictor(board, mask);
    const scalarValue = result.v.length > 0 ? result.v[0] : 0;
    return { pi: result.pi.slice(), v: scalarValue };
  };
  const proxyOptions: SantoriniWasmProxyOptions = {
    BoardCtor: wasm.SantoriniBoard,
    MctsCtor: wasm.SantoriniMcts,
    predictor: rustPredictor,
    initialSimulations: 25,
  };
  const proxy = new SantoriniWasmProxy(proxyOptions);
  const game = new Santorini();
  game.setBackend(proxy);
  const selector = new MoveSelector(game);
  return { game, selector };
}

interface CreateRuntimeOptions {
  evaluationEnabled: boolean;
  enginePreference?: EnginePreference;
}

export async function createSantoriniRuntime(options: CreateRuntimeOptions): Promise<RuntimeResult> {
  const { enginePreference = 'python' } = options ?? {};
  const predictor = await ensureOnnxPredictor();

  if (enginePreference === 'rust') {
    try {
      return await createRustRuntime(predictor);
    } catch (error) {
      console.warn('Rust engine failed to initialize. Falling back to Python runtime.', error);
    }
  }

  return createPythonRuntime(predictor);
}

export function resetSantoriniRuntimeCache(): void {
  wasmModulePromise = null;
  predictorPromise = null;
  onnxSessionCache = null;
  pyodidePromise = null;
  if (typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>).predict) {
    delete (globalThis as Record<string, unknown>).predict;
  }
}
