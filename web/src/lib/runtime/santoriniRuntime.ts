import { Santorini } from '@game/santorini';
import { MoveSelector } from '@game/moveSelector';
import { loadExternalScript } from './scriptLoader';
import { SANTORINI_MODEL_URL, SANTORINI_PY_MODULES } from '@/lib/santoriniAssets';

type PyodideInstance = Awaited<ReturnType<NonNullable<Window['loadPyodide']>>>;

let pyodidePromise: Promise<PyodideInstance> | null = null;
let onnxSessionCache: { url: string; promise: Promise<any> } | null = null;
const moduleCache = new Map<string, Promise<Uint8Array>>();
let hydratedSignature: string | null = null;

/**
 * Downloads a binary/text asset once and keeps it in-memory so Pyodide can be rehydrated
 * without paying the network cost again. Browsers will still cache the request, but this
 * guard avoids duplicate `arrayBuffer()` work when multiple callers race.
 */
async function fetchModuleBytes(url: string): Promise<Uint8Array> {
  if (!moduleCache.has(url)) {
    moduleCache.set(
      url,
      (async () => {
        const response = await fetch(url, { cache: 'force-cache' });
        if (!response.ok) {
          throw new Error(`Failed to fetch Santorini asset ${url}`);
        }
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
      })(),
    );
  }
  return moduleCache.get(url)!;
}

async function ensurePyodideLoaded(pyodideUrl: string): Promise<PyodideInstance> {
  if (pyodidePromise) {
    return pyodidePromise;
  }

  pyodidePromise = (async () => {
    await loadExternalScript({
      src: pyodideUrl,
      integrity: import.meta.env.VITE_PYODIDE_INTEGRITY,
      crossOrigin: 'anonymous',
    });
    const loadPyodideFn = window.loadPyodide;
    if (!loadPyodideFn) {
      throw new Error('Pyodide runtime script failed to expose window.loadPyodide');
    }
    const instance = await loadPyodideFn({ fullStdLib: false });
    await instance.loadPackage('numpy');
    return instance;
  })();

  return pyodidePromise;
}

async function hydratePythonModules(pyodide: PyodideInstance): Promise<void> {
  const signature = SANTORINI_PY_MODULES.map((module) => module.url).join('|');
  if (hydratedSignature === signature) {
    return;
  }
  await Promise.all(
    SANTORINI_PY_MODULES.map(async ({ url, filename }) => {
      const data = await fetchModuleBytes(url);
      pyodide.FS.writeFile(filename, data);
    }),
  );
  hydratedSignature = signature;
}

async function ensureOnnxSession(): Promise<any> {
  if (onnxSessionCache && onnxSessionCache.url === SANTORINI_MODEL_URL) {
    return onnxSessionCache.promise;
  }

  const promise = (async () => {
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
    const SIZE_CB = [1, 25, 3] as const;
    const ONNX_OUTPUT_SIZE = 162;

    (window as any).predict = async (canonicalBoard: Iterable<number>, valids: Iterable<number>) => {
      const boardArray = Array.from(canonicalBoard);
      const validsArray = Array.from(valids);
      const tensorBoard = new window.ort.Tensor('float32', Float32Array.from(boardArray), SIZE_CB);
      const tensorValid = new window.ort.Tensor('bool', new Uint8Array(validsArray), [1, ONNX_OUTPUT_SIZE]);
      const results = await session.run({
        board: tensorBoard,
        valid_actions: tensorValid,
      });
      return {
        pi: Array.from(results.pi.data),
        v: Array.from(results.v.data),
      };
    };

    return session;
  })();

  onnxSessionCache = { url: SANTORINI_MODEL_URL, promise };
  return promise;
}

/**
 * Ensures the Pyodide runtime, Python bridge modules, and optional ONNX session are ready,
 * then returns a fresh `Santorini` + `MoveSelector` pair wired to that runtime.
 */
export async function createSantoriniRuntime(options: { evaluationEnabled: boolean }): Promise<{
  pyodide: PyodideInstance;
  game: Santorini;
  selector: MoveSelector;
}> {
  const pyodideUrl = import.meta.env.VITE_PYODIDE_URL as string | undefined;
  if (!pyodideUrl) {
    throw new Error('Missing VITE_PYODIDE_URL environment variable');
  }

  const pyodide = await ensurePyodideLoaded(pyodideUrl);
  await hydratePythonModules(pyodide);

  if (options.evaluationEnabled) {
    await ensureOnnxSession();
  }

  const game = new Santorini();
  game.setBackend(pyodide);
  const selector = new MoveSelector(game);

  return { pyodide, game, selector };
}

export function resetSantoriniRuntimeCache(): void {
  hydratedSignature = null;
}
