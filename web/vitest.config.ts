import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const setupFile = fileURLToPath(new URL('./src/test/setup.ts', import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'https://santorini.test/',
      },
    },
    setupFiles: [setupFile],
    dir: srcDir,
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
    },
    coverage: {
      reporter: ['text'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
      '@theme': path.resolve(rootDir, './src/theme'),
      '@components': path.resolve(rootDir, './src/components'),
      '@hooks': path.resolve(rootDir, './src/hooks'),
      '@game': path.resolve(rootDir, './src/game'),
      '@shared': path.resolve(rootDir, '../shared'),
      '@wasm': path.resolve(rootDir, '../rust-wasm/pkg'),
    },
  },
});
