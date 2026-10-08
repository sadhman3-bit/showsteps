import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/coverage/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // core must stay free of DOM globals at import time
    files: ['packages/core/**/*.ts'],
    languageOptions: { globals: { ...globals.es2022 } },
  },
  {
    files: ['packages/ui/**/*.{ts,tsx}', 'apps/extension/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
  {
    files: ['fixtures/demo-app/public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  {
    files: ['**/*.{mjs,cjs,js}', '**/*.config.ts', 'e2e/**/*.ts'],
    ignores: ['fixtures/demo-app/public/**'],
    languageOptions: { globals: { ...globals.node } },
  },
);
