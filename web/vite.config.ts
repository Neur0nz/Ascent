import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import * as path from 'node:path';
import { wasmWatchPlugin } from './vite-plugin-wasm-watch';

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname);
  const env = loadEnv(mode, envDir, '');
  const isDev = mode === 'development';

  return {
    plugins: [
      react(),
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
      host: true,
      fs: {
        allow: [path.resolve(__dirname), path.resolve(__dirname, '..')]
      }
    },
    preview: {
      port: Number(env.VITE_PREVIEW_PORT ?? 4173),
      host: true
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
    }
  };
});
