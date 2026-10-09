import { PageRecorder } from '../lib/content/capture';

// Registered at runtime when a capture starts (never in the manifest), in every frame. No
// `matches` here: WXT would turn them into install-time host permissions. The background
// registers it for the origins the user granted.
export default defineContentScript({
  allFrames: true,
  registration: 'runtime',
  main() {
    const flag = '__trailmarkCapture';
    const scope = globalThis as unknown as Record<string, unknown>;
    if (scope[flag]) return; // already running in this frame (injected twice)
    scope[flag] = true;
    void new PageRecorder().init();
  },
});
