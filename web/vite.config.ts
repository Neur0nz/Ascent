import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import * as path from 'node:path';
import { VitePWA } from 'vite-plugin-pwa';
import { wasmWatchPlugin } from './vite-plugin-wasm-watch';

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname);
  const env = loadEnv(mode, envDir, '');
  const isDev = mode === 'development';
  const isTest = mode === 'test';

  return {
    plugins: [
      react(),
      VitePWA({
        srcDir: 'src',
        filename: 'service-worker.ts',
        strategies: 'injectManifest',
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        manifest: {
          name: env.VITE_APP_TITLE ?? 'Ascent',
          short_name: env.VITE_APP_TITLE ?? 'Ascent',
          description:
            'Play Santorini online, practice against an AlphaZero-style AI, and review matches with built-in analysis tools.',
          start_url: env.VITE_PUBLIC_BASE_PATH ?? '/',
          display: 'standalone',
          background_color: '#0f172a',
          theme_color: '#0f172a',
          icons: [
            {
              src: '/favicon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
            {
              src: '/icons/icon-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable',
            },
            {
              src: '/icons/icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        },
        workbox: {
          cleanupOutdatedCaches: true,
        },
      }),
      ...(isDev ? [wasmWatchPlugin()] : []),
    ],
    envDir,
    base: env.VITE_PUBLIC_BASE_PATH ?? '/',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@theme': path.resolve(__dirname, 'src/theme'),
        '@components': path.resolve(__dirname, 'src/components'),
        '@hooks': path.resolve(__dirname, 'src/hooks'),
        '@game': path.resolve(__dirname, 'src/game'),
        '@shared': path.resolve(__dirname, '../shared'),
        '@wasm': path.resolve(__dirname, '../rust-wasm/pkg')
      }
    },
    server: {
      port: Number(env.VITE_DEV_PORT ?? 5174),
      host: isTest ? '127.0.0.1' : true,
      fs: {
        allow: [path.resolve(__dirname), path.resolve(__dirname, '..')]
      }
    },
    preview: {
      port: Number(env.VITE_PREVIEW_PORT ?? 4173),
      host: true
    },
    worker: {
      format: 'es',
      rollupOptions: {
        output: {
          manualChunks: undefined,
          inlineDynamicImports: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      assetsDir: 'assets',
      sourcemap: mode === 'development',
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', '@chakra-ui/react', '@chakra-ui/icons', 'framer-motion']
          }
        }
      }
    },
    test: {
      globals: true,
      environment: 'jsdom',
      server: {
        host: '127.0.0.1',
        port: 0,
      },
    },
  };
});
