import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Electron main process: one CommonJS file with the workspace packages bundled in.
export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, 'dist/main'),
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    ssr: resolve(import.meta.dirname, 'src/main/index.ts'),
    rolldownOptions: {
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { format: 'cjs', entryFileNames: 'index.cjs' },
    },
  },
  ssr: { noExternal: true },
});
