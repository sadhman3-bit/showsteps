import {
  ANNOTATION_HALO,
  textOn,
  HIGHLIGHT_ALT_COLOR,
  HIGHLIGHT_COLOR,
  navyRing,
  ringBlendsIn,
  type Annotation,
  type Guide,
  type GuideStore,
  type Rect,
  type Redactor,
  type Step,
} from '@showsteps/core';
import { encodeImage } from '../editor/imageio.js';
import type { ExportImage, ExportInput } from '@showsteps/core/export';
import { ANNOTATION_FONT, strokeFor } from '../components/Annotations.js';
import { blurRadius } from '../guide/Screenshot.js';
import { mimeFor } from '../hooks.js';
import { brandFor, kitAsset, type BrandSources } from '../brand/sources.js';

/** Widest picture written into exports; larger screenshots are scaled down. */
const MAX_EXPORT_WIDTH = 1600;

type Ctx = OffscreenCanvasRenderingContext2D;

function drawAnnotation(ctx: Ctx, a: Annotation, imageWidth: number): void {
  const sw = strokeFor(imageWidth);
  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (a.kind) {
    case 'rect':
      ctx.beginPath();
      ctx.roundRect(a.rect.x, a.rect.y, a.rect.w, a.rect.h, sw);
      ctx.stroke();
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(
        a.rect.x + a.rect.w / 2,
        a.rect.y + a.rect.h / 2,
        Math.abs(a.rect.w / 2),
        Math.abs(a.rect.h / 2),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      break;
    case 'arrow': {
      // Same geometry as the SVG arrow in Annotations.tsx.
      const dx = a.to.x - a.from.x;
      const dy = a.to.y - a.from.y;
      const len = Math.hypot(dx, dy) || 1;
      const head = Math.min(len * 0.45, sw * 5);
      const ux = dx / len;
      const uy = dy / len;
      const bx = a.to.x - ux * head;
      const by = a.to.y - uy * head;
      const px = -uy * head * 0.55;
      const py = ux * head * 0.55;
      ctx.beginPath();
      ctx.moveTo(a.from.x, a.from.y);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(a.to.x, a.to.y);
      ctx.lineTo(bx + px, by + py);
      ctx.lineTo(bx - px, by - py);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'pen':
      ctx.lineWidth = a.width ?? sw;
      ctx.beginPath();
      a.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      break;
    case 'text': {
      const size = a.size ?? sw * 7;
      ctx.font = `600 ${size}px ${ANNOTATION_FONT}`;
      ctx.textBaseline = 'hanging';
      ctx.strokeStyle = ANNOTATION_HALO;
      ctx.lineWidth = size / 6;
      ctx.strokeText(a.text, a.at.x, a.at.y);
      ctx.fillText(a.text, a.at.x, a.at.y);
      break;
    }
    case 'badge': {
      const r = sw * 4.5;
      ctx.beginPath();
      ctx.arc(a.at.x, a.at.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ANNOTATION_HALO;
      ctx.lineWidth = sw / 1.5;
      ctx.stroke();
      ctx.fillStyle = textOn(a.color);
      ctx.font = `700 ${r * 1.15}px ${ANNOTATION_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(a.number), a.at.x, a.at.y);
      break;
    }
  }
  ctx.restore();
}

async function encodePng(canvas: OffscreenCanvas): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Side of a mosaic block, in screenshot pixels. */
const MOSAIC = 16;

/**
 * Burn a blur into the picture: first a 16-px mosaic of the region's own pixels (each block one
 * average colour), then the blur on top for the usual look. A blur of the original pixels alone
 * can sometimes be undone for short numbers in a known font; block averages can't.
 */
function burnBlur(ctx: Ctx, bitmap: ImageBitmap, W: number, H: number, r: Rect, radius: number) {
  const sx = bitmap.width / W;
  const sy = bitmap.height / H;
  const bw = Math.max(1, Math.ceil(r.w / MOSAIC));
  const bh = Math.max(1, Math.ceil(r.h / MOSAIC));
  const small = new OffscreenCanvas(bw, bh);
  const sctx = small.getContext('2d');
  if (!sctx) return;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(bitmap, r.x * sx, r.y * sy, r.w * sx, r.h * sy, 0, 0, bw, bh);
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, bw, bh, r.x, r.y, bw * MOSAIC, bh * MOSAIC);
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(small, 0, 0, bw, bh, r.x, r.y, bw * MOSAIC, bh * MOSAIC);
  ctx.restore();
}

/**
 * A step's picture as readers see it, burned into pixels: crop when magnified, blurs (so the
 * hidden data is gone from the exported file), the highlight box and annotations.
 */
export async function flattenStepImage(
  step: Step,
  source: Blob,
  maxWidth = MAX_EXPORT_WIDTH,
  /** The brand's highlight colour (B2); ShowSteps's pink when left out. */
  highlight: string = HIGHLIGHT_COLOR,
): Promise<ExportImage | undefined> {
  const shot = step.human.screenshot;
  if (!shot) return undefined;
  const bitmap = await createImageBitmap(source);
  try {
    const { width: W, height: H } = shot;
    const view: Rect = shot.crop && (shot.zoom ?? 1) > 1 ? shot.crop : { x: 0, y: 0, w: W, h: H };
    const scale = Math.min(1, maxWidth / view.w);
    const width = Math.max(1, Math.round(view.w * scale));
    const height = Math.max(1, Math.round(view.h * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(scale, scale);
    ctx.translate(-view.x, -view.y);
    ctx.drawImage(bitmap, 0, 0, W, H);
    for (const r of step.human.blurs) burnBlur(ctx, bitmap, W, H, r, blurRadius(W) * scale);
    const box = step.human.actionBox;
    if (box) {
      const sw = strokeFor(W);
      // Navy instead of pink when the author chose it or the interface around the box is pink.
      const navy = navyRing(step.human.highlight, () => {
        const probe = new OffscreenCanvas(W, H);
        const pctx = probe.getContext('2d', { willReadFrequently: true });
        if (!pctx) return false;
        pctx.drawImage(bitmap, 0, 0, W, H);
        return ringBlendsIn(pctx.getImageData(0, 0, W, H).data, W, H, box);
      });
      ctx.save();
      ctx.strokeStyle = navy ? HIGHLIGHT_ALT_COLOR : highlight;
      // A soft halo, then the ring.
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = sw * 2.5;
      ctx.beginPath();
      ctx.roundRect(box.x - sw, box.y - sw, box.w + sw * 2, box.h + sw * 2, sw * 3);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = sw;
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, sw * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const a of step.human.annotations) drawAnnotation(ctx, a, W);
    return { bytes: await encodePng(canvas), width, height, mime: 'image/png' };
  } finally {
    bitmap.close();
  }
}

/**
 * A step's stored picture for a shared guide file (H1): the crop and blurs burned in, without the
 * highlight and annotations (they stay editable in guide.json). Full size, so text stays sharp.
 */
export async function redactStepImage(
  step: Step,
  source: Blob,
): Promise<{ png: Blob; view: Rect } | undefined> {
  const shot = step.human.screenshot;
  if (!shot) return undefined;
  const bitmap = await createImageBitmap(source);
  try {
    const { width: W, height: H } = shot;
    const view: Rect = shot.crop && (shot.zoom ?? 1) > 1 ? shot.crop : { x: 0, y: 0, w: W, h: H };
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(view.w)),
      Math.max(1, Math.round(view.h)),
    );
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.translate(-view.x, -view.y);
    ctx.drawImage(bitmap, 0, 0, W, H);
    for (const r of step.human.blurs) burnBlur(ctx, bitmap, W, H, r, blurRadius(W));
    return { png: await canvas.convertToBlob({ type: 'image/png' }), view };
  } finally {
    bitmap.close();
  }
}

/** The redactor `exportGuideArchive` uses for shared files: redacted, then stored like any picture. */
export const shareRedactor: Redactor = async (step, bytes, name) => {
  const done = await redactStepImage(step, new Blob([bytes as BlobPart], { type: mimeFor(name) }));
  if (!done) return undefined;
  const img = await encodeImage(done.png);
  return {
    full: img.full,
    thumb: img.thumb,
    ext: img.ext,
    width: img.width,
    height: img.height,
    origin: { x: done.view.x, y: done.view.y },
    scale: img.width / done.view.w,
  };
};

/** Any stored image (the branding logo) re-encoded as PNG, which every export format accepts. */
async function toPng(source: Blob): Promise<ExportImage> {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    return {
      bytes: await encodePng(canvas),
      width: bitmap.width,
      height: bitmap.height,
      mime: 'image/png',
    };
  } finally {
    bitmap.close();
  }
}

async function storedBlob(
  store: GuideStore,
  guideId: string,
  file: string,
): Promise<Blob | undefined> {
  const name = file.replace(/^img\//, '');
  const bytes = await store.getImage(guideId, name);
  return bytes ? new Blob([bytes as BlobPart], { type: mimeFor(name) }) : undefined;
}

/**
 * Everything an exporter needs: the guide plus its finished pictures, and its brand (B2) with
 * the brand's logos, cover picture and fonts. `kit` uses another kit for this one export.
 */
export async function prepareExport(
  store: GuideStore,
  guide: Guide,
  brandOptions: { sources?: BrandSources | undefined; kit?: string } = {},
): Promise<ExportInput> {
  const { sources, kit } = brandOptions;
  const brand = await brandFor(sources, guide, kit);
  const images = new Map<string, ExportImage>();
  for (const b of guide.blocks) {
    if (b.kind !== 'step' || !b.human.screenshot) continue;
    const blob = await storedBlob(store, guide.id, b.human.screenshot.file);
    const image = blob
      ? await flattenStepImage(b, blob, MAX_EXPORT_WIDTH, brand.colors.highlight)
      : undefined;
    if (image) images.set(b.id, image);
  }
  /** A picture from the brand's kit, as PNG. */
  const kitPicture = async (name: string | undefined) => {
    const bytes = name ? await kitAsset(sources, brand.id, name) : undefined;
    return bytes ? toPng(new Blob([bytes as BlobPart], { type: mimeFor(name ?? '') })) : undefined;
  };
  const from = brand.logoFrom;
  const logo =
    from?.from === 'guide'
      ? await storedBlob(store, guide.id, from.name).then((b) => (b ? toPng(b) : undefined))
      : from?.from === 'kit'
        ? await kitPicture(from.name)
        : undefined;
  const logoOnDark = await kitPicture(brand.logoOnDark);
  const coverImage =
    brand.cover.style === 'image' ? await kitPicture(brand.cover.image) : undefined;
  const fonts = new Map<string, Uint8Array>();
  for (const f of [brand.fonts.body, brand.fonts.heading]) {
    if (!f?.startsWith('custom:') || fonts.has(f.slice(7))) continue;
    const bytes = await kitAsset(sources, brand.id, f.slice(7));
    if (bytes) fonts.set(f.slice(7), bytes);
  }
  return {
    guide,
    images,
    brand,
    ...(logo ? { logo } : {}),
    ...(logoOnDark ? { logoOnDark } : {}),
    ...(coverImage ? { coverImage } : {}),
    ...(fonts.size ? { fonts } : {}),
  };
}
