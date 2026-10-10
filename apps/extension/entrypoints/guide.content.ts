import { GuidePage } from '../lib/content/guide';

// Guide Me, Run for me, notes and pins. Registered at runtime for the sites the user has
// granted (never in the manifest), in every frame. Does nothing until there is something to show.
export default defineContentScript({
  allFrames: true,
  registration: 'runtime',
  main() {
    const flag = '__trailmarkGuide';
    const scope = globalThis as unknown as Record<string, unknown>;
    if (scope[flag]) return;
    scope[flag] = true;
    void new GuidePage().init();
  },
});
