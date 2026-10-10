import { fitWidth } from '@trailmark/core';

export interface EncodedImage {
  full: Uint8Array;
  thumb: Uint8Array;
  ext: 'webp' | 'png';
  width: number;
  height: number;
}

const MAX_SIDE = 4096;

async function toBytes(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function encodeCanvas(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<{ bytes: Uint8Array; ext: 'webp' | 'png' }> {
  const webp = await toBytes(canvas, 'image/webp', quality);
  if (webp?.type === 'image/webp')
    return { bytes: new Uint8Array(await webp.arrayBuffer()), ext: 'webp' };
  const png = await toBytes(canvas, 'image/png');
  if (!png) throw new Error('encode failed');
  return { bytes: new Uint8Array(await png.arrayBuffer()), ext: 'png' };
}

/** Decode an uploaded or pasted image and produce the stored WebP (or PNG) plus a thumbnail. */
export async function encodeImage(blob: Blob, quality = 0.9): Promise<EncodedImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    const full = await encodeCanvas(canvas, quality);

    const t = fitWidth(width, height, 320);
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = t.width;
    thumbCanvas.height = t.height;
    const ctx = thumbCanvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, t.width, t.height);
    }
    const thumb = await encodeCanvas(thumbCanvas, 0.8);
    return { full: full.bytes, thumb: thumb.bytes, ext: full.ext, width, height };
  } finally {
    bitmap.close();
  }
}

/** First image on the clipboard, from a paste event or the async Clipboard API. */
export async function clipboardImage(event?: ClipboardEvent): Promise<Blob | undefined> {
  const fromEvent = Array.from(event?.clipboardData?.items ?? []).find((i) =>
    i.type.startsWith('image/'),
  );
  if (fromEvent) return fromEvent.getAsFile() ?? undefined;
  if (event || !navigator.clipboard?.read) return undefined;
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) return await item.getType(type);
    }
  } catch {
    // permission denied or nothing readable
  }
  return undefined;
}
