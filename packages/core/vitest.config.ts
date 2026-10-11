import { defineConfig } from 'vitest/config';

// Some tests build long PDFs or write real folders: give them room on a busy machine.
export default defineConfig({ test: { testTimeout: 15_000 } });
