import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Preload script (sandboxed, so CommonJS and nothing but electron).
export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, 'dist/preload'),
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    ssr: resolve(import.meta.dirname, 'src/preload/index.ts'),
    rolldownOptions: {
      external: ['electron'],
      output: { format: 'cjs', entryFileNames: 'index.cjs' },
    },
  },
  ssr: { noExternal: true },
});
