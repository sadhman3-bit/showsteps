import { describe, expect, it } from 'vitest';
import { ringBlendsIn, navyRing } from '../src/index.js';

function image(w: number, h: number, rgb: [number, number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([...rgb, 255], i * 4);
  return px;
}

describe('highlight ring colour', () => {
  const box = { x: 40, y: 40, w: 60, h: 20 };

  it('switches to navy on a pink or red interface', () => {
    expect(ringBlendsIn(image(200, 120, [230, 30, 90]), 200, 120, box)).toBe(true);
    expect(ringBlendsIn(image(200, 120, [220, 20, 40]), 200, 120, box)).toBe(true);
  });

  it('stays pink on white, grey or blue', () => {
    for (const c of [
      [255, 255, 255],
      [128, 128, 128],
      [40, 60, 200],
    ] as const)
      expect(ringBlendsIn(image(200, 120, [...c]), 200, 120, box)).toBe(false);
  });

  it('lets the author override it', () => {
    expect(navyRing('navy', () => false)).toBe(true);
    expect(navyRing('signal', () => true)).toBe(false);
    expect(navyRing('auto', () => true)).toBe(true);
    expect(navyRing(undefined, () => false)).toBe(false);
  });
});
