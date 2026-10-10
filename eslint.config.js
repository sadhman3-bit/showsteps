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
      'e2e/.replay/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // core must stay free of DOM globals: DOM helpers receive nodes and reach the window
    // through node.ownerDocument.defaultView, so core runs in Node, workers and every frame.
    files: ['packages/core/src/**/*.ts'],
    languageOptions: { globals: { ...globals.es2022 } },
    rules: {
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'navigator',
          'location',
          'history',
          'self',
          'MutationObserver',
          'getComputedStyle',
          'Node',
          'Element',
          'HTMLElement',
          'indexedDB',
        ].map((name) => ({ name, message: 'core must not use DOM globals; pass them in.' })),
      ],
    },
  },
  {
    files: ['packages/ui/**/*.{ts,tsx}', 'apps/extension/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
  {
    // Tests assert on fixtures they control; non-null assertions keep them readable.
    files: ['**/test/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
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
