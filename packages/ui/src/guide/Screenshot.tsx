import type { GuideStore, Rect, Step } from '@trailmark/core';
import { useId } from 'preact/hooks';
import { AnnotationShape, strokeFor } from '../components/Annotations.js';
import { useImageUrl } from '../hooks.js';

/** Blur strength that hides text at any screenshot size. */
export function blurRadius(imageWidth: number): number {
  return Math.max(10, Math.round(imageWidth / 90));
}

/**
 * The layers drawn over a screenshot, in image pixels: blurred regions (a blurred copy of the
 * image clipped to each region), the Action Box and annotations. Shared with the image editor.
 */
export function ImageLayers({
  url,
  step,
  showActionBox = true,
  idPrefix,
}: {
  url: string;
  step: Step;
  showActionBox?: boolean;
  idPrefix: string;
}) {
  const shot = step.human.screenshot;
  if (!shot) return null;
  const { width: W, height: H } = shot;
  const box = step.human.actionBox;
  const sw = strokeFor(W);
  return (
    <>
      <defs>
        <filter id={`${idPrefix}-blur`} x="0" y="0" width="100%" height="100%">
          <feGaussianBlur stdDeviation={blurRadius(W)} />
        </filter>
        {step.human.blurs.map((r, i) => (
          <clipPath id={`${idPrefix}-clip-${i}`} key={i}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} />
          </clipPath>
        ))}
      </defs>
      <image href={url} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />
      {step.human.blurs.map((_, i) => (
        <g key={i} clip-path={`url(#${idPrefix}-clip-${i})`} data-blur={i}>
          <image
            href={url}
            x={0}
            y={0}
            width={W}
            height={H}
            preserveAspectRatio="none"
            filter={`url(#${idPrefix}-blur)`}
          />
        </g>
      ))}
      {showActionBox && box ? (
        <rect
          class="tm-shot__box"
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          rx={sw * 2}
          fill="none"
          stroke-width={sw}
        />
      ) : null}
      {step.human.annotations.map((a) => (
        <AnnotationShape key={a.id} a={a} imageWidth={W} />
      ))}
    </>
  );
}

/** A step's screenshot as readers see it: crop (when magnified), blurs, highlight and annotations. */
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
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!shot) return null;
  const view: Rect =
    magnify && shot.crop && (shot.zoom ?? 1) > 1
      ? shot.crop
      : { x: 0, y: 0, w: shot.width, h: shot.height };
  return (
    <figure class="tm-shot" style={{ aspectRatio: `${view.w} / ${view.h}` }}>
      {url ? (
        <svg
          class="tm-shot__svg"
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          role="img"
          aria-label={alt}
          preserveAspectRatio="xMidYMid meet"
        >
          <ImageLayers url={url} step={step} idPrefix={`s${id}`} />
        </svg>
      ) : (
        <div class="tm-shot__loading" aria-hidden="true" />
      )}
    </figure>
  );
}
