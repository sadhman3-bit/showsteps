import { rippleSvg, trailSvg } from '@showsteps/core';

// Brand patterns (section 4 of the brand): welcome and idle headers, empty states, About and
// splash screens, store images. Never behind screenshots, body text or form controls.
const ripple = rippleSvg();
const trail = trailSvg();

/** Navy rings spreading from a click, on signal pink. Decorative. */
export function RipplePattern({ class: cls }: { class?: string }) {
  return (
    <div
      class={`ss-pattern ${cls ?? ''}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ripple }}
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
