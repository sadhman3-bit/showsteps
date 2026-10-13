import type { Rect } from './schema.js';

/** How a step's highlight ring is coloured: chosen from the picture, or set by the author. */
export type HighlightChoice = 'auto' | 'signal' | 'navy';

/** Hue of signal pink (#FF2E6E), in degrees. */
const SIGNAL_HUE = 342;

function hueOf(r: number, g: number, b: number): { hue: number; sat: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return { hue: 0, sat: 0 };
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, sat: d / max };
}

/**
 * True when the area just around the Action Box is mostly pink or red, so a pink ring would
 * not stand out: more than `share` of the pixels in a `band`-pixel ring around the box are
 * within 25° of signal pink's hue (and clearly coloured, not grey). `pixels` is RGBA, row-major.
 */
export function ringBlendsIn(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  box: Rect,
  band = 12,
  share = 0.4,
): boolean {
  const x0 = Math.max(0, Math.floor(box.x - band));
  const y0 = Math.max(0, Math.floor(box.y - band));
  const x1 = Math.min(width, Math.ceil(box.x + box.w + band));
  const y1 = Math.min(height, Math.ceil(box.y + box.h + band));
  let near = 0;
  let total = 0;
  // Every other pixel is plenty, and keeps big boxes quick.
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const inside =
        x > box.x + band &&
        x < box.x + box.w - band &&
        y > box.y + band &&
        y < box.y + box.h - band;
      if (inside) continue;
      const i = (y * width + x) * 4;
      const { hue, sat } = hueOf(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0);
      total++;
      const diff = Math.min(Math.abs(hue - SIGNAL_HUE), 360 - Math.abs(hue - SIGNAL_HUE));
      if (sat > 0.25 && diff <= 25) near++;
    }
  }
  return total > 0 && near / total > share;
}

/** Whether to draw the ring in navy rather than pink. */
export function navyRing(choice: HighlightChoice | undefined, blendsIn: () => boolean): boolean {
  if (choice === 'navy') return true;
  if (choice === 'signal') return false;
  return blendsIn();
}
