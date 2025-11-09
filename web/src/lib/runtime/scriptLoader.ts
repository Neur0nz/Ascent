const scriptPromises = new Map<string, Promise<void>>();

declare const importScripts: ((...urls: string[]) => void) | undefined;

export interface ScriptDescriptor {
  src: string;
  integrity?: string;
  crossOrigin?: 'anonymous' | 'use-credentials';
}

/**
 * Loads a UMD script in a worker context by fetching and evaluating it.
 * This is necessary for module workers where importScripts() is not available.
 * The browser's fetch cache ensures we don't re-download the script unnecessarily.
 */
async function loadScriptInWorker(src: string, integrity?: string, crossOrigin?: 'anonymous' | 'use-credentials'): Promise<void> {
  const response = await fetch(src, {
    integrity,
    mode: 'cors',
    credentials: crossOrigin === 'use-credentials' ? 'include' : 'same-origin',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch script: ${response.status} ${response.statusText}`);
  }

  const scriptText = await response.text();
  
  // For UMD scripts in module workers, we need to evaluate them in global scope.
  // Using Function constructor is the standard approach for this use case.
  // Note: Blob URLs with import() won't work here since UMD scripts aren't ES modules.
  new Function(scriptText)();
}

/**
 * Injects an external script exactly once per `src` and resolves when it finishes loading.
 * Subsequent calls with the same URL reuse the original promise so callers can safely `await`
 * without worrying about duplicate DOM nodes or race conditions.
 */
export function loadExternalScript(descriptor: ScriptDescriptor): Promise<void> {
  const { src, integrity, crossOrigin } = descriptor;
  if (scriptPromises.has(src)) {
    return scriptPromises.get(src)!;
  }

  const promise = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      // Worker context: prefer importScripts when supported, otherwise attempt dynamic import with a fetch+eval fallback.
      if (typeof importScripts === 'function') {
        try {
          importScripts(src);
          resolve();
          return;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (!(errorMessage.includes('Module scripts') || errorMessage.includes('importScripts'))) {
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
          }
        }
      }

      import(/* @vite-ignore */ src)
        .then((module) => {
          const exportedLoadPyodide =
            (module && typeof module.loadPyodide === 'function' && module.loadPyodide) ||
            (module &&
              module.default &&
              typeof (module.default as Record<string, unknown>).loadPyodide === 'function' &&
              ((module.default as { loadPyodide: () => Promise<unknown> }).loadPyodide as unknown));
          if (exportedLoadPyodide && typeof (globalThis as typeof globalThis & { loadPyodide?: unknown }).loadPyodide !== 'function') {
            (globalThis as typeof globalThis & { loadPyodide?: unknown }).loadPyodide = exportedLoadPyodide;
          }
          resolve();
        })
        .catch(() => loadScriptInWorker(src, integrity, crossOrigin).then(resolve).catch(reject));
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[data-managed-src="${src}"], script[src="${src}"]`);
    if (existing && (existing as HTMLScriptElement).dataset.managedSrc === src) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.managedSrc = src;
    if (integrity) {
      script.integrity = integrity;
      script.crossOrigin = crossOrigin ?? 'anonymous';
    } else if (crossOrigin) {
      script.crossOrigin = crossOrigin;
    }
    script.onload = () => resolve();
    script.onerror = (event) => {
      script.remove();
      reject(new Error(`Failed to load script ${src}: ${event?.toString?.() ?? 'unknown error'}`));
    };
    document.head.appendChild(script);
  });

  scriptPromises.set(src, promise);
  return promise;
}
