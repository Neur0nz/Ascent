import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    dir: fileURLToPath(new URL('./src', import.meta.url)),
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
      '@': path.resolve(fileURLToPath(new URL('.', import.meta.url)), './src'),
      '@theme': path.resolve(fileURLToPath(new URL('.', import.meta.url)), './src/theme'),
      '@components': path.resolve(fileURLToPath(new URL('.', import.meta.url)), './src/components'),
      '@hooks': path.resolve(fileURLToPath(new URL('.', import.meta.url)), './src/hooks'),
      '@game': path.resolve(fileURLToPath(new URL('.', import.meta.url)), './src/game'),
      '@shared': path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../shared'),
      '@wasm': path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../rust-wasm/pkg'),
    },
  },
});
