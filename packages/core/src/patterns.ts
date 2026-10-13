/**
 * ShowSteps brand patterns as SVG markup, shared by the app (RipplePattern, TrailPattern),
 * exports (the cover band) and brand/build.mjs (static files). Brand surfaces only: never behind
 * screenshots, body text or form controls.
 */

const PINK = '#FF2E6E';
const NAVY = '#14102B';
const WHITE = '#FFFFFF';

export interface PatternOptions {
  /** viewBox width and height (the pattern scales to cover its box). */
  width?: number;
  height?: number;
  /** Unique id prefix when several patterns share a page. */
  id?: string;
}

/** Ripple: navy rings spreading from a click near the lower left, on signal pink. */
export function rippleSvg({ width = 640, height = 280 }: PatternOptions = {}): string {
  const radii = [36, 76, 118, 162, 208, 256, 306, 358, 412, 468, 526, 586, 648];
  // Wider boxes get more rings at the same scale (the gaps keep growing by about 4).
  const cx = Math.min(Math.round(width * 0.16), 110);
  const cy = Math.round(height * 0.8);
  const reach = Math.hypot(width - cx, cy);
  while ((radii.at(-1) ?? 0) < reach) {
    const n = radii.length;
    radii.push((radii[n - 1] ?? 0) + ((radii[n - 1] ?? 0) - (radii[n - 2] ?? 0)) + 4);
  }
  const rings = radii
    .map((r, i) => {
      const w = 12 - (8 * Math.min(i, 12)) / 12;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${NAVY}" stroke-width="${w.toFixed(2)}"/>`;
    })
    .join('');
  // A cursor arrow, tip on the click point.
  const arrow = `<path transform="translate(${cx - 2} ${cy - 2})" d="M0 0 L0 30 L8 23 L13 35 L19 32 L14 21 L24 21 Z" fill="${WHITE}" stroke="${NAVY}" stroke-width="2.5" stroke-linejoin="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><rect width="${width}" height="${height}" fill="${PINK}"/>${rings}${arrow}</svg>`;
}

/** Trail: a smooth pink path through numbered stops on navy; the last stop is pink. */
export function trailSvg({ width = 640, height = 280 }: PatternOptions = {}): string {
  const fx = (x: number) => Math.round((x / 640) * width);
  const fy = (y: number) => Math.round((y / 280) * height);
  type Pt = readonly [number, number];
  const stops: Pt[] = (
    [
      [70, 200],
      [210, 110],
      [360, 190],
      [500, 90],
      [600, 170],
    ] as const
  ).map(([x, y]) => [fx(x), fy(y)] as const);
  // Catmull-Rom through the stops, as cubic Béziers, starting and ending off the edges.
  const pts: Pt[] = [[-40, fy(250)], ...stops, [width + 40, fy(60)]];
  const at = (i: number): Pt => pts[Math.min(pts.length - 1, Math.max(0, i))] ?? [0, 0];
  let d = `M${at(0)[0]} ${at(0)[1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0]} ${p2[1]}`;
  }
  const dots = stops
    .map(([x, y], i) => {
      const last = i === stops.length - 1;
      return `<circle cx="${x}" cy="${y}" r="17" fill="${last ? PINK : WHITE}" stroke="${NAVY}" stroke-width="3"/><text x="${x}" y="${y + 6}" text-anchor="middle" font-family="'Funnel Display','Segoe UI',system-ui,sans-serif" font-weight="800" font-size="17" fill="${NAVY}">${i + 1}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><rect width="${width}" height="${height}" fill="${NAVY}"/><path d="${d}" fill="none" stroke="${PINK}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>${dots}</svg>`;
}
