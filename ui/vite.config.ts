import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The MCP App view: one self-contained HTML file (scripts + styles inlined) served from the ui:// resource.
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: { '@shared': resolve(here, '../src/shared') },
  },
  build: {
    outDir: resolve(here, '../dist/ui'),
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: { input: resolve(here, 'mcp-app.html') },
  },
});
