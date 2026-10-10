import type { Guide, Rect, Step } from '../schema.js';
import { roundRect } from '../geometry.js';
import { updateStep } from './ops.js';

/** Remember the captured screenshot before the first edit, so it can be restored later. */
export function withOriginal(step: Step): Step {
  if (step.human.original || !step.human.screenshot) return step;
  return {
    ...step,
    human: {
      ...step.human,
      original: {
        screenshot: step.human.screenshot,
        ...(step.human.actionBox ? { actionBox: step.human.actionBox } : {}),
      },
    },
  };
}

/** Undo every image edit: original screenshot, Action Box and crop; no blurs or annotations. */
export function resetImage(step: Step): Step {
  const original = step.human.original;
  if (!original) return { ...step, human: { ...step.human, blurs: [], annotations: [] } };
  const human: Step['human'] = {
    ...step.human,
    screenshot: original.screenshot,
    blurs: [],
    annotations: [],
  };
  if (original.actionBox) human.actionBox = original.actionBox;
  else delete human.actionBox;
  delete human.original;
  return { ...step, human };
}

/**
 * Magnify setting: `level` ≤ 1 shows the whole screenshot; above 1 crops around the Action Box
 * (or the image centre) so the area is shown `level` times larger.
 */
export function withMagnify(step: Step, level: number): Step {
  const shot = step.human.screenshot;
  if (!shot) return step;
  const screenshot = { ...shot };
  if (level <= 1) {
    delete screenshot.crop;
    delete screenshot.zoom;
  } else {
    const box = step.human.actionBox ?? {
      x: shot.width / 2 - 1,
      y: shot.height / 2 - 1,
      w: 2,
      h: 2,
    };
    // An explicit magnify always zooms by `level`, centred on the highlight and kept inside the image.
    const w = shot.width / level;
    const h = shot.height / level;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    screenshot.crop = roundRect({
      x: Math.min(Math.max(cx - w / 2, 0), shot.width - w),
      y: Math.min(Math.max(cy - h / 2, 0), shot.height - h),
      w,
      h,
    });
    screenshot.zoom = Math.round((shot.width / screenshot.crop.w) * 100) / 100;
  }
  return { ...step, human: { ...step.human, screenshot } };
}

/** Steps whose screenshots are the same size as `stepId`'s, which a blur region can apply to. */
export function bulkBlurCandidates(guide: Guide, stepId: string): Step[] {
  const source = guide.blocks.find((b): b is Step => b.kind === 'step' && b.id === stepId);
  const size = source?.human.screenshot;
  if (!size) return [];
  return guide.blocks.filter(
    (b): b is Step =>
      b.kind === 'step' &&
      b.id !== stepId &&
      b.human.screenshot?.width === size.width &&
      b.human.screenshot.height === size.height,
  );
}

/** Add a blur region to several steps at once (Bulk Blur). */
export function applyBlurToSteps(guide: Guide, rect: Rect, stepIds: readonly string[]): Guide {
  let out = guide;
  for (const id of stepIds) {
    out = updateStep(out, id, (s) =>
      s.human.screenshot ? { ...s, human: { ...s.human, blurs: [...s.human.blurs, rect] } } : s,
    );
  }
  return out;
}
