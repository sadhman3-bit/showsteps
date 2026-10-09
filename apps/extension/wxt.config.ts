import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

// `wxt build --mode e2e` produces a test build that may access the local demo app without the
// permission prompt Playwright cannot click. Normal builds request host access at capture time.
export default defineConfig({
  manifestVersion: 3,
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}{{modeSuffix}}',
  manifest: ({ mode }) => ({
    name: 'Trailmark',
    description: 'Record a process once and get a step-by-step guide. Local-first and private.',
    minimum_chrome_version: '116',
    permissions: ['sidePanel', 'storage', 'unlimitedStorage', 'scripting', 'webNavigation'],
    optional_host_permissions: ['<all_urls>'],
    // Test build: as if the user already granted access at capture start.
    ...(mode === 'e2e' ? { host_permissions: ['<all_urls>'] } : {}),
    action: { default_title: 'Open Trailmark' },
    commands: {
      'toggle-capture': {
        suggested_key: { default: 'Alt+Shift+R' },
        description: 'Start or finish a capture',
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  }),
  vite: () => ({
    plugins: [preact()],
  }),
});
