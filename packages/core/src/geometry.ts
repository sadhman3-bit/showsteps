import type { Point, Rect } from './schema.js';

/** Scale a rect from CSS pixels to image pixels. */
export function scaleRect(r: Rect, scale: number): Rect {
  return { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale };
}

export function offsetRect(r: Rect, by: Point): Rect {
  return { ...r, x: r.x + by.x, y: r.y + by.y };
}

export function roundRect(r: Rect): Rect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y };
}

/** Clamp a rect to lie inside `width` × `height`. */
export function clampRect(r: Rect, width: number, height: number): Rect {
  const x = Math.min(Math.max(r.x, 0), width);
  const y = Math.min(Math.max(r.y, 0), height);
  const right = Math.min(Math.max(r.x + r.w, 0), width);
  const bottom = Math.min(Math.max(r.y + r.h, 0), height);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * The highlight drawn around a target: its bounding box in image pixels, padded and clamped.
 * `bbox` is in top-frame CSS pixels; `scale` is image pixels per CSS pixel.
 */
export function actionBoxFor(
  bbox: Rect,
  scale: number,
  imageWidth: number,
  imageHeight: number,
  padCss = 4,
): Rect {
  const padded = {
    x: bbox.x - padCss,
    y: bbox.y - padCss,
    w: bbox.w + 2 * padCss,
    h: bbox.h + 2 * padCss,
  };
  return roundRect(clampRect(scaleRect(padded, scale), imageWidth, imageHeight));
}

export interface AutoCrop {
  crop: Rect;
  /** Magnification when the crop is shown at the full image's display width. */
  zoom: number;
}

/**
 * A crop that magnifies the area around the Action Box while keeping enough context to
 * recognise the screen. Keeps the image's aspect ratio, never zooms past `maxZoom`, and stays
 * inside the image. Returns zoom 1 (no crop) when the box is already large.
 */
export function autoCrop(
  box: Rect,
  imageWidth: number,
  imageHeight: number,
  maxZoom = 2,
): AutoCrop {
  const full: AutoCrop = { crop: { x: 0, y: 0, w: imageWidth, h: imageHeight }, zoom: 1 };
  if (imageWidth <= 0 || imageHeight <= 0 || maxZoom <= 1) return full;
  const aspect = imageWidth / imageHeight;
  // Room for the box plus generous context on every side.
  let w = Math.max(box.w * 3, imageWidth / maxZoom);
  let h = w / aspect;
  if (h < box.h * 3) {
    h = box.h * 3;
    w = h * aspect;
  }
  if (w >= imageWidth * 0.9 || h >= imageHeight * 0.9) return full;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x = Math.min(Math.max(cx - w / 2, 0), imageWidth - w);
  const y = Math.min(Math.max(cy - h / 2, 0), imageHeight - h);
  const crop = roundRect({ x, y, w, h });
  return { crop, zoom: Math.round((imageWidth / crop.w) * 100) / 100 };
}

/** Fit `width` × `height` inside `maxWidth`, keeping the aspect ratio (never upscales). */
export function fitWidth(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}
