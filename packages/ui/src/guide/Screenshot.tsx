import type { GuideStore, Rect, Step } from '@trailmark/core';
import { useImageUrl } from '../hooks.js';

const pct = (n: number, of: number) => `${(n / of) * 100}%`;

/**
 * A step's screenshot: the auto-crop (when magnified) with the Action Box drawn on top.
 * Everything is positioned in percentages, so it scales with the container.
 */
export function Screenshot({
  store,
  guideId,
  step,
  alt,
  magnify = true,
}: {
  store: GuideStore;
  guideId: string;
  step: Step;
  alt: string;
  magnify?: boolean;
}) {
  const shot = step.human.screenshot;
  const url = useImageUrl(store, guideId, shot?.file.replace(/^img\//, ''));
  if (!shot) return null;
  const view: Rect =
    magnify && shot.crop && (shot.zoom ?? 1) > 1
      ? shot.crop
      : { x: 0, y: 0, w: shot.width, h: shot.height };
  const box = step.human.actionBox;
  return (
    <figure class="tm-shot" style={{ aspectRatio: `${view.w} / ${view.h}` }}>
      {url ? (
        <img
          src={url}
          alt={alt}
          draggable={false}
          style={{
            width: pct(shot.width, view.w),
            left: pct(-view.x, view.w),
            top: pct(-view.y, view.h),
          }}
        />
      ) : (
        <div class="tm-shot__loading" aria-hidden="true" />
      )}
      {box ? (
        <div
          class="tm-shot__box"
          aria-hidden="true"
          style={{
            left: pct(box.x - view.x, view.w),
            top: pct(box.y - view.y, view.h),
            width: pct(box.w, view.w),
            height: pct(box.h, view.h),
          }}
        />
      ) : null}
    </figure>
  );
}
