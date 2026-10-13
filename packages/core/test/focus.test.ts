import { describe, expect, it } from 'vitest';
import { MIN_CROP_WIDTH, autoCrop, focusRect } from '../src/index.js';

describe('framing a picture around its Action Box', () => {
  const box = { x: 1500, y: 900, w: 120, h: 40 };

  it('auto-crops to about 2.2× the box, at least 720 px wide, with the box inside', () => {
    const { crop, zoom } = autoCrop(box, 2560, 1440, 4);
    expect(crop.w).toBeGreaterThanOrEqual(MIN_CROP_WIDTH);
    expect(crop.x).toBeLessThanOrEqual(box.x);
    expect(crop.x + crop.w).toBeGreaterThanOrEqual(box.x + box.w);
    expect(crop.y).toBeLessThanOrEqual(box.y);
    expect(crop.y + crop.h).toBeGreaterThanOrEqual(box.y + box.h);
    expect(zoom).toBeGreaterThan(1);
  });

  it('frames a 16:10 thumbnail centred on the box and inside the image', () => {
    const r = focusRect(box, 2560, 1440, 16 / 10);
    expect(r.w / r.h).toBeCloseTo(1.6, 1);
    expect(r.x).toBeLessThanOrEqual(box.x);
    expect(r.x + r.w).toBeGreaterThanOrEqual(box.x + box.w);
    expect(r.x + r.w).toBeLessThanOrEqual(2560);
    expect(r.y + r.h).toBeLessThanOrEqual(1440);
    expect(Math.abs(r.x + r.w / 2 - (box.x + box.w / 2))).toBeLessThan(2);
  });

  it('shows the top of the picture when there is no box', () => {
    const r = focusRect(undefined, 1280, 2000, 16 / 10);
    expect(r).toEqual({ x: 0, y: 0, w: 1280, h: 800 });
  });
});
