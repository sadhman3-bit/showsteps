import { rippleSvg, trailSvg } from '@showsteps/core';

// Brand patterns (section 4 of the brand): welcome and idle headers, empty states, About and
// splash screens, store images. Never behind screenshots, body text or form controls.
const ripple = rippleSvg();
const rippleWide = rippleSvg({ width: 1280, height: 200 });
const trail = trailSvg();

/** Navy rings spreading from a click, on signal pink. Decorative. */
export function RipplePattern({ class: cls, wide }: { class?: string; wide?: boolean }) {
  return (
    <div
      class={`ss-pattern ${cls ?? ''}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: wide ? rippleWide : ripple }}
    />
  );
}

/** A pink path through numbered stops, on navy. Decorative. */
export function TrailPattern({ class: cls }: { class?: string }) {
  return (
    <div
      class={`ss-pattern ${cls ?? ''}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: trail }}
    />
  );
}
