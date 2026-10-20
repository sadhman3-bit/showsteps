import { fitWidth, type PageText } from '@showsteps/core';

/** Chrome allows two captureVisibleTab calls per second; keep a small margin. */
export const MIN_SHOT_INTERVAL_MS = 520;
export const THUMB_WIDTH = 320;

/** Decides whether a screenshot may be taken now or the previous one must be reused. */
export class ShotLimiter {
  private last = -Infinity;

  constructor(
    private readonly minIntervalMs = MIN_SHOT_INTERVAL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** True (and reserves the slot) if a capture may happen now. */
  tryAcquire(): boolean {
    const t = this.now();
    if (t - this.last < this.minIntervalMs) return false;
    this.last = t;
    return true;
  }
}

export type PendingShot =
  | {
      kind: 'captured';
      dataUrl: string;
      viewportWidth: number;
      dpr: number;
      /** Words on screen at that moment, in CSS pixels of the viewport (Secure Blur). */
      words?: PageText;
      /** Encoding, started as soon as the picture was taken (it takes a second or two). */
      encoded?: Promise<EncodedShot>;
    }
  | { kind: 'skipped' };

export interface EncodedShot {
  full: Uint8Array;
  thumb: Uint8Array;
  /** "webp", or "png" if this browser cannot encode WebP. */
  ext: 'webp' | 'png';
  width: number;
  height: number;
}

async function encode(
  canvas: OffscreenCanvas,
  quality: number,
): Promise<{ bytes: Uint8Array; ext: 'webp' | 'png' }> {
  const webp = await canvas.convertToBlob({ type: 'image/webp', quality });
  if (webp.type === 'image/webp')
    return { bytes: new Uint8Array(await webp.arrayBuffer()), ext: 'webp' };
  const png = await canvas.convertToBlob({ type: 'image/png' });
  return { bytes: new Uint8Array(await png.arrayBuffer()), ext: 'png' };
}

/** Decode a captureVisibleTab data URL and produce the stored image plus a thumbnail. */
export async function encodeScreenshot(dataUrl: string, quality = 0.9): Promise<EncodedShot> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = bitmap;
    const fullCanvas = new OffscreenCanvas(width, height);
    fullCanvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    const full = await encode(fullCanvas, quality);

    const size = fitWidth(width, height, THUMB_WIDTH);
    const thumbCanvas = new OffscreenCanvas(size.width, size.height);
    const ctx = thumbCanvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    }
    const thumb = await encode(thumbCanvas, 0.8);
    return { full: full.bytes, thumb: thumb.bytes, ext: full.ext, width, height };
  } finally {
    bitmap.close();
  }
}

/** Run-log pictures: JPEG at about 70 % quality, at most this wide. */
export const LOG_SHOT_WIDTH = 1280;

/** A scheduled run's step picture: a captureVisibleTab data URL as a small JPEG. */
export async function encodeLogShot(dataUrl: string): Promise<Blob> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    const size = fitWidth(bitmap.width, bitmap.height, LOG_SHOT_WIDTH);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    }
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  } finally {
    bitmap.close();
  }
}
