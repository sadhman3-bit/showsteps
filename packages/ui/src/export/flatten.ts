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
  type Step,
} from '@showsteps/core';
import type { ExportImage, ExportInput } from '@showsteps/core/export';
import { ANNOTATION_FONT, strokeFor } from '../components/Annotations.js';
import { blurRadius } from '../guide/Screenshot.js';
import { mimeFor } from '../hooks.js';

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

/**
 * A step's picture as readers see it, burned into pixels: crop when magnified, blurs (so the
 * hidden data is gone from the exported file), the highlight box and annotations.
 */
export async function flattenStepImage(
  step: Step,
  source: Blob,
  maxWidth = MAX_EXPORT_WIDTH,
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
    for (const r of step.human.blurs) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.filter = `blur(${blurRadius(W) * scale}px)`;
      ctx.drawImage(bitmap, 0, 0, W, H);
      ctx.restore();
    }
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
      ctx.strokeStyle = navy ? HIGHLIGHT_ALT_COLOR : HIGHLIGHT_COLOR;
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

/** Everything an exporter needs: the guide plus its finished pictures and logo. */
export async function prepareExport(store: GuideStore, guide: Guide): Promise<ExportInput> {
  const images = new Map<string, ExportImage>();
  for (const b of guide.blocks) {
    if (b.kind !== 'step' || !b.human.screenshot) continue;
    const blob = await storedBlob(store, guide.id, b.human.screenshot.file);
    const image = blob ? await flattenStepImage(b, blob) : undefined;
    if (image) images.set(b.id, image);
  }
  const logoFile = guide.branding?.logo;
  const logoBlob = logoFile ? await storedBlob(store, guide.id, logoFile) : undefined;
  return { guide, images, ...(logoBlob ? { logo: await toPng(logoBlob) } : {}) };
}
