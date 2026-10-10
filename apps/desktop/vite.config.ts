import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Renderer pages: the library window, the capture toolbar and the Guide Me overlay.
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  plugins: [preact()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist/renderer'),
    emptyOutDir: true,
    // The exporters chunk (PDF and Word libraries) loads only when someone exports.
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      input: {
        index: resolve(import.meta.dirname, 'src/renderer/index.html'),
        controller: resolve(import.meta.dirname, 'src/renderer/controller.html'),
        overlay: resolve(import.meta.dirname, 'src/renderer/overlay.html'),
      },
    },
  },
});
