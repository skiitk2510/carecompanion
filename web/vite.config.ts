import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The simulated Alexa+ web experience. In dev, /api and /mcp are proxied to the Node server on :3000.
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@ui': resolve(here, '../ui/src'),
      '@shared': resolve(here, '../src/shared'),
    },
  },
  build: {
    outDir: resolve(here, '../dist/web'),
    emptyOutDir: true,
    target: 'es2020',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/mcp': 'http://127.0.0.1:3000',
      '/healthz': 'http://127.0.0.1:3000',
    },
  },
});
