import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import extensionKey from './extension-key.json' with { type: 'json' };

// `wxt build --mode e2e` produces a test build that may access the local demo app without the
// permission prompt Playwright cannot click. Normal builds request host access at capture time.
export default defineConfig({
  manifestVersion: 3,
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}{{modeSuffix}}',
  manifest: ({ mode }) => ({
    name: 'ABCXYZ',
    description: 'Record a process once and get a step-by-step guide. Local-first and private.',
    minimum_chrome_version: '116',
    // Public key only: pins the extension ID ("Load unpacked" from any folder) so the desktop
    // app's native messaging host can name it. Nothing is published.
    key: extensionKey.key,
    permissions: ['sidePanel', 'storage', 'unlimitedStorage', 'scripting', 'webNavigation'],
    optional_host_permissions: ['<all_urls>'],
    // Asked for when the person connects the desktop app (Settings).
    optional_permissions: ['nativeMessaging'],
    // Test build: as if the user already granted access at capture start and connected the app.
    ...(mode === 'e2e'
      ? {
          host_permissions: ['<all_urls>'],
          permissions: [
            'sidePanel',
            'storage',
            'unlimitedStorage',
            'scripting',
            'webNavigation',
            'nativeMessaging',
          ],
        }
      : {}),
    action: { default_title: 'Open ABCXYZ' },
    commands: {
      'toggle-capture': {
        suggested_key: { default: 'Alt+Shift+R' },
        description: 'Start or finish a capture',
      },
    },
    content_security_policy: {
      // 'wasm-unsafe-eval' lets the bundled OCR engine (WebAssembly) run; no JavaScript eval.
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  }),
  vite: () => ({
    plugins: [preact()],
    // The exporters chunk (PDF and Word libraries, ~0.9 MB) loads only when someone exports.
    build: { chunkSizeWarningLimit: 1024 },
  }),
});
