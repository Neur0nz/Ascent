const scriptPromises = new Map<string, Promise<void>>();

export interface ScriptDescriptor {
  src: string;
  integrity?: string;
  crossOrigin?: 'anonymous' | 'use-credentials';
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
      reject(new Error(`Cannot load script ${src} outside the browser`));
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
