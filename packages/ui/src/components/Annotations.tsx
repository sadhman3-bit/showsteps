import type { Annotation } from '@trailmark/core';

/** Stroke width that reads well at any screenshot size (image pixels). */
export function strokeFor(imageWidth: number): number {
  return Math.max(3, Math.round(imageWidth / 320));
}

/** One annotation as SVG, in image-pixel coordinates. */
export function AnnotationShape({
  a,
  imageWidth,
  selected = false,
}: {
  a: Annotation;
  imageWidth: number;
  selected?: boolean;
}) {
  const sw = strokeFor(imageWidth);
  const common = {
    'data-annotation': a.id,
    class: selected ? 'tm-ann tm-ann--selected' : 'tm-ann',
  };
  switch (a.kind) {
    case 'rect':
      return (
        <rect
          {...common}
          x={a.rect.x}
          y={a.rect.y}
          width={a.rect.w}
          height={a.rect.h}
          rx={sw}
          fill="none"
          stroke={a.color}
          stroke-width={sw}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          {...common}
          cx={a.rect.x + a.rect.w / 2}
          cy={a.rect.y + a.rect.h / 2}
          rx={a.rect.w / 2}
          ry={a.rect.h / 2}
          fill="none"
          stroke={a.color}
          stroke-width={sw}
        />
      );
    case 'arrow': {
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
      return (
        <g {...common}>
          <line
            x1={a.from.x}
            y1={a.from.y}
            x2={bx}
            y2={by}
            stroke={a.color}
            stroke-width={sw}
            stroke-linecap="round"
          />
          <polygon
            points={`${a.to.x},${a.to.y} ${bx + px},${by + py} ${bx - px},${by - py}`}
            fill={a.color}
          />
        </g>
      );
    }
    case 'pen':
      return (
        <polyline
          {...common}
          points={a.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={a.color}
          stroke-width={a.width ?? sw}
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      );
    case 'text': {
      const size = a.size ?? sw * 7;
      return (
        <text
          {...common}
          x={a.at.x}
          y={a.at.y}
          fill={a.color}
          font-size={size}
          font-weight="600"
          font-family="'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
          stroke="#ffffff"
          stroke-width={size / 6}
          paint-order="stroke"
          dominant-baseline="hanging"
        >
          {a.text}
        </text>
      );
    }
    case 'badge': {
      const r = sw * 4.5;
      return (
        <g {...common}>
          <circle
            cx={a.at.x}
            cy={a.at.y}
            r={r}
            fill={a.color}
            stroke="#ffffff"
            stroke-width={sw / 1.5}
          />
          <text
            x={a.at.x}
            y={a.at.y}
            fill="#ffffff"
            font-size={r * 1.15}
            font-weight="700"
            font-family="'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
            text-anchor="middle"
            dominant-baseline="central"
          >
            {a.number}
          </text>
        </g>
      );
    }
  }
}

/** Bounding box of an annotation, for selection outlines and hit testing. */
export function annotationBounds(
  a: Annotation,
  imageWidth: number,
): { x: number; y: number; w: number; h: number } {
  const sw = strokeFor(imageWidth);
  switch (a.kind) {
    case 'rect':
    case 'ellipse':
      return a.rect;
    case 'arrow':
      return {
        x: Math.min(a.from.x, a.to.x),
        y: Math.min(a.from.y, a.to.y),
        w: Math.abs(a.to.x - a.from.x),
        h: Math.abs(a.to.y - a.from.y),
      };
    case 'pen': {
      const xs = a.points.map((p) => p.x);
      const ys = a.points.map((p) => p.y);
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      };
    }
    case 'text': {
      const size = a.size ?? sw * 7;
      return { x: a.at.x, y: a.at.y, w: a.text.length * size * 0.6, h: size * 1.2 };
    }
    case 'badge': {
      const r = sw * 4.5;
      return { x: a.at.x - r, y: a.at.y - r, w: r * 2, h: r * 2 };
    }
  }
}

/** Move an annotation by (dx, dy) image pixels. */
export function moveAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  const p = (pt: { x: number; y: number }) => ({ x: pt.x + dx, y: pt.y + dy });
  switch (a.kind) {
    case 'rect':
    case 'ellipse':
      return { ...a, rect: { ...a.rect, x: a.rect.x + dx, y: a.rect.y + dy } };
    case 'arrow':
      return { ...a, from: p(a.from), to: p(a.to) };
    case 'pen':
      return { ...a, points: a.points.map(p) };
    case 'text':
    case 'badge':
      return { ...a, at: p(a.at) };
  }
}
