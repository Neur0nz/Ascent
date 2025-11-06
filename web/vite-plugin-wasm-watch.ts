import type { Plugin } from 'vite';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { watch } from 'node:fs';
import { resolve, join } from 'node:path';
import { readdir } from 'node:fs/promises';

const execAsync = promisify(exec);

export function wasmWatchPlugin(): Plugin {
  let isBuilding = false;
  const watchers: ReturnType<typeof watch>[] = [];
  let debounceTimer: NodeJS.Timeout | null = null;

  // Recursively watch directory by watching individual files
  const watchDirectory = async (dir: string, callback: (filename: string) => void) => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await watchDirectory(fullPath, callback);
        } else if (entry.isFile() && entry.name.endsWith('.rs')) {
          const watcher = watch(fullPath, (eventType) => {
            if (eventType === 'change') {
              callback(entry.name);
            }
          });
          watchers.push(watcher);
        }
      }
    } catch (error) {
      // Ignore errors for missing directories
    }
  };

  return {
    name: 'wasm-watch',
    async configureServer(server) {
      const rustSrcDir = resolve(__dirname, '../rust-wasm/src');
      const rustCargoToml = resolve(__dirname, '../rust-wasm/Cargo.toml');

      const rebuildWasm = async () => {
        if (isBuilding) return;
        isBuilding = true;

        try {
          console.log('🦀 Rebuilding Rust WASM...');
          await execAsync('wasm-pack build --target web --release', {
            cwd: resolve(__dirname, '../rust-wasm'),
          });
          console.log('✅ Rust WASM rebuild complete');
          // Trigger full reload to pick up the new WASM
          server.ws.send({
            type: 'full-reload',
          });
        } catch (error) {
          console.error('❌ Rust WASM build failed:', error);
        } finally {
          isBuilding = false;
        }
      };

      const debouncedRebuild = () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(rebuildWasm, 500); // Debounce 500ms
      };

      // Watch Rust source files recursively
      await watchDirectory(rustSrcDir, (filename) => {
        console.log(`🔄 Rust file changed: ${filename}`);
        debouncedRebuild();
      });

      // Watch Cargo.toml
      const cargoWatcher = watch(rustCargoToml, () => {
        console.log('🔄 Cargo.toml changed');
        debouncedRebuild();
      });
      watchers.push(cargoWatcher);
    },
    buildEnd() {
      watchers.forEach((watcher) => watcher.close());
      watchers.length = 0;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },
  };
}

