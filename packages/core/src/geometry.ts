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

/** Crops are at least this many image pixels wide, so magnified pictures stay sharp. */
export const MIN_CROP_WIDTH = 720;

/**
 * A crop that magnifies the area around the Action Box while keeping enough context to
 * recognise the screen: about 2.2× the box, at least MIN_CROP_WIDTH pixels wide, with the whole
 * box in view. Keeps the image's aspect ratio, never zooms past `maxZoom`, and stays inside the
 * image. Returns zoom 1 (no crop) when the box is already large.
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
  let w = Math.max(box.w * 2.2, MIN_CROP_WIDTH, imageWidth / maxZoom);
  let h = w / aspect;
  if (h < box.h * 2.2) {
    h = box.h * 2.2;
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

/**
 * The part of a picture to show in a small frame of the given aspect (width / height), centred
 * on the Action Box with about `factor` times its size around it, inside the image. Without a
 * box, the top of the picture.
 */
export function focusRect(
  box: Rect | undefined,
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  factor = 2.2,
): Rect {
  let w = imageWidth;
  let h = w / aspect;
  if (h > imageHeight) {
    h = imageHeight;
    w = h * aspect;
  }
  if (!box) return roundRect({ x: (imageWidth - w) / 2, y: 0, w, h });
  // Zoom in only as far as the box with context still fits, and never below a third of the image.
  const want = Math.max(box.w * factor, box.h * factor * aspect, imageWidth / 3);
  if (want < w) {
    w = want;
    h = w / aspect;
  }
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x = Math.min(Math.max(cx - w / 2, 0), imageWidth - w);
  const y = Math.min(Math.max(cy - h / 2, 0), imageHeight - h);
  return roundRect({ x, y, w, h });
}
