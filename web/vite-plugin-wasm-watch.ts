import type { Plugin } from 'vite';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { watch } from 'node:fs';
import { resolve } from 'node:path';

const execAsync = promisify(exec);

export function wasmWatchPlugin(): Plugin {
  let isBuilding = false;
  let watcher: ReturnType<typeof watch> | null = null;
  let cargoWatcher: ReturnType<typeof watch> | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;

  return {
    name: 'wasm-watch',
    configureServer(server) {
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

      // Watch Rust source directory
      watcher = watch(
        rustSrcDir,
        { recursive: true },
        (eventType, filename) => {
          if (filename && filename.endsWith('.rs')) {
            console.log(`🔄 Rust file changed: ${filename}`);
            debouncedRebuild();
          }
        }
      );

      // Watch Cargo.toml
      cargoWatcher = watch(
        rustCargoToml,
        { persistent: true },
        () => {
          console.log('🔄 Cargo.toml changed');
          debouncedRebuild();
        }
      );
    },
    buildEnd() {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      if (cargoWatcher) {
        cargoWatcher.close();
        cargoWatcher = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },
  };
}

