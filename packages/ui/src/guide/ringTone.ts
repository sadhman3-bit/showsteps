import { navyRing, ringBlendsIn, type Step } from '@showsteps/core';
import { useEffect, useState } from 'preact/hooks';

const cache = new Map<string, boolean>();

/** Read a picture's pixels and check whether pink would blend in around the box. */
async function blendsIn(url: string, step: Step): Promise<boolean> {
  const box = step.human.actionBox;
  if (!box) return false;
  const key = `${url}|${box.x},${box.y},${box.w},${box.h}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  const result = ringBlendsIn(data, canvas.width, canvas.height, box);
  cache.set(key, result);
  return result;
}

/**
 * True when this step's highlight should be navy: the author chose it, or (automatic) the
 * interface around the Action Box is pink or red.
 */
export function useNavyRing(url: string | undefined, step: Step): boolean {
  const choice = step.human.highlight;
  const [auto, setAuto] = useState(false);
  const box = step.human.actionBox;
  useEffect(() => {
    if (!url || !box || choice === 'navy' || choice === 'signal') return;
    let live = true;
    void blendsIn(url, step)
      .then((v) => live && setAuto(v))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [url, box?.x, box?.y, box?.w, box?.h, choice]);
  return navyRing(choice, () => auto);
}

/** CSS that recolours the ring (`.ss-shot__box`, `.ss-shot__halo`) in navy. */
export const NAVY_RING_STYLE = { '--ss-shot-ring': 'var(--ss-chrome-bg)' } as const;
