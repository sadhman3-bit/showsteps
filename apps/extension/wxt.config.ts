import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'Trailmark',
    description: 'Record a process once and get a step-by-step guide. Local-first and private.',
    minimum_chrome_version: '116',
    permissions: ['sidePanel', 'storage', 'unlimitedStorage'],
    action: { default_title: 'Open Trailmark' },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
  },
  vite: () => ({
    plugins: [preact()],
  }),
});
