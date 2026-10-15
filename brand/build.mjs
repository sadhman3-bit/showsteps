// ShowSteps brand build: writes the logo, wordmark and lockup SVGs in brand/ (all text turned
// into paths, so nothing depends on an installed font), the patterns, and every raster asset:
// extension icons, desktop icon (.png and .ico), tray icons and favicons. Run: pnpm brand
// Fonts (SIL Open Font License, brand/fonts/OFL-*.txt): Instrument Serif Italic for the "1",
// Hanken Grotesk ExtraBold for the wordmark. Neither ships as a web font.
import { mkdirSync, writeFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import opentype from 'opentype.js';
import pngToIco from 'png-to-ico';

const root = fileURLToPath(new URL('..', import.meta.url));
const brand = `${root}brand/`;
const { rippleSvg, trailSvg } = await import(`file:///${root}packages/core/dist/patterns.js`);

const NAVY = '#14102B';
const INK_LIGHT = '#F5F2FF';
const PINK = '#FF2E6E';
const PINK_DARK = '#FF4D82';
const BLUSH = '#FFF8F9';
const WHITE = '#FFFFFF';

const serif = opentype.loadSync(`${brand}fonts/InstrumentSerif-Italic.ttf`);
const grotesk = opentype.loadSync(`${brand}fonts/HankenGrotesk-ExtraBold.woff`);

const r = (n) => Math.round(n * 100) / 100;

/** The "1" as a path, its visual centre at x = 48 and its baseline at y. */
function one(size, baseline) {
  const probe = serif.getPath('1', 0, baseline, size);
  const box = probe.getBoundingBox();
  const dx = 48 - (box.x1 + box.x2) / 2;
  return serif.getPath('1', dx, baseline, size).toPathData(2);
}

/** The master mark and its variants (96×96). */
function mark({
  ink,
  pink,
  pinkOpacity,
  ringR = 36,
  ringW = 4,
  fill = 'none',
  oneSize = 58,
  oneStroke = 0,
}) {
  const d = one(oneSize, 68);
  const stroke = oneStroke
    ? ` stroke="${ink}" stroke-width="${oneStroke}" stroke-linejoin="round"`
    : '';
  return [
    `<circle cx="48" cy="48" r="${ringR}" fill="${fill}" stroke="${ink}" stroke-width="${ringW}"/>`,
    `<rect x="22" y="56" width="52" height="16" rx="5" fill="${pink}" fill-opacity="${pinkOpacity}"/>`,
    `<path d="${d}" fill="${ink}"${stroke}/>`,
  ].join('');
}
const svg = (viewBox, body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${extra}>${body}</svg>\n`;

const marks = {
  mark: mark({ ink: NAVY, pink: PINK, pinkOpacity: 0.6 }),
  // Icons sit on any toolbar or store background: a white disc keeps the 1 readable on dark ones.
  'mark-icon': mark({ ink: NAVY, pink: PINK, pinkOpacity: 0.6, fill: WHITE }),
  'mark-dark': mark({ ink: INK_LIGHT, pink: PINK_DARK, pinkOpacity: 0.7 }),
  'mark-small': mark({
    ink: NAVY,
    pink: PINK,
    pinkOpacity: 0.85,
    ringR: 34,
    ringW: 7,
    fill: BLUSH,
    oneSize: 64,
    oneStroke: 2.5,
  }),
};

/** "SHOWSTEPS", tracked 0.14em, as one path. Returns the path and its box. */
function wordmark(size = 48) {
  const text = 'SHOWSTEPS';
  const scale = size / grotesk.unitsPerEm;
  const tracking = 0.14 * size;
  let x = 0;
  const parts = [];
  const glyphs = grotesk.stringToGlyphs(text);
  glyphs.forEach((g, i) => {
    parts.push(g.getPath(x, 0, size).toPathData(2));
    const next = glyphs[i + 1];
    x += g.advanceWidth * scale + (next ? grotesk.getKerningValue(g, next) * scale + tracking : 0);
  });
  const capHeight = grotesk.tables.os2.sCapHeight * scale;
  return { d: parts.join(''), width: x, capHeight };
}

const wm = wordmark(48);
const wordmarkSvg = (ink) =>
  svg(
    `0 ${r(-wm.capHeight)} ${r(wm.width)} ${r(wm.capHeight)}`,
    `<path d="${wm.d}" fill="${ink}"/>`,
  );

/** Mark at 1.4× the cap height (ring to ring), 16 px gap, centred on the cap height. */
function lockup(markBody, ink) {
  const ringOuter = 76; // ring diameter in the 96 box, stroke included
  const markSize = 1.4 * wm.capHeight;
  const s = markSize / ringOuter;
  const markBox = 96 * s;
  const gap = 16;
  const tx = -(48 - ringOuter / 2) * s; // ring's left edge at x = 0
  const height = markSize;
  const markY = -(markBox - height) / 2;
  const textX = markSize + gap;
  const textY = (height + wm.capHeight) / 2;
  const width = textX + wm.width;
  return svg(
    `0 0 ${r(width)} ${r(height)}`,
    `<g transform="translate(${r(tx)} ${r(markY)}) scale(${r(s * 1000) / 1000})">${markBody}</g>` +
      `<path transform="translate(${r(textX)} ${r(textY)})" d="${wm.d}" fill="${ink}"/>`,
  );
}

const files = {
  'mark.svg': svg('0 0 96 96', marks.mark),
  'mark-dark.svg': svg('0 0 96 96', marks['mark-dark']),
  'mark-small.svg': svg('0 0 96 96', marks['mark-small']),
  'wordmark.svg': wordmarkSvg(NAVY),
  'wordmark-dark.svg': wordmarkSvg(INK_LIGHT),
  'lockup.svg': lockup(marks.mark, NAVY),
  'lockup-dark.svg': lockup(marks['mark-dark'], INK_LIGHT),
  'tile.svg': svg(
    '0 0 512 512',
    `<rect width="512" height="512" rx="${r(512 * 0.22)}" fill="${BLUSH}"/>` +
      `<g transform="translate(${r((512 - 512 * 0.78) / 2)} ${r((512 - 512 * 0.78) / 2)}) scale(${r((512 * 0.78) / 96)})">${marks.mark}</g>`,
  ),
  'pattern-ripple.svg': `${rippleSvg()}\n`,
  'pattern-trail.svg': `${trailSvg()}\n`,
};
for (const [name, text] of Object.entries(files)) writeFileSync(`${brand}${name}`, text);

// ---------- Raster assets ----------

const png = (svgText, size) =>
  new Resvg(svgText, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' })
    .render()
    .asPng();
/** A mark cropped so its ring fills `fill` of the square (Chrome Web Store: ~112 of 128). */
const cropped = (body, fill) => {
  const ringOuter = 76;
  const view = ringOuter / fill;
  const o = 48 - view / 2;
  return svg(`${r(o)} ${r(o)} ${r(view)} ${r(view)}`, body);
};
const write = (path, bytes) => {
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  writeFileSync(path, bytes);
};

const ext = `${root}apps/extension/`;
const small = (size) => png(cropped(marks['mark-small'], 0.97), size);
const big = (size) => png(cropped(marks['mark-icon'], 112 / 128), size);
write(`${ext}public/icon/16.png`, small(16));
write(`${ext}public/icon/32.png`, small(32));
write(`${ext}public/icon/48.png`, big(48));
write(`${ext}public/icon/128.png`, big(128));
write(`${ext}public/icon/favicon.svg`, cropped(marks['mark-small'], 0.97));
write(`${ext}assets/icon.svg`, files['mark.svg']);

const desk = `${root}apps/desktop/resources/`;
write(`${desk}icon.png`, png(files['tile.svg'], 512));
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoPngs = icoSizes.map((size) => (size <= 32 ? small(size) : png(files['tile.svg'], size)));
write(`${desk}icon.ico`, await pngToIco(icoPngs));
write(`${desk}tray.png`, small(16));
write(`${desk}tray@2x.png`, small(32));
const smallDark = (size) => png(cropped(marks['mark-dark'], 0.97), size);
write(`${desk}tray-dark.png`, smallDark(16));
write(`${desk}tray-dark@2x.png`, smallDark(32));
write(`${root}apps/desktop/src/renderer/public/favicon.svg`, cropped(marks['mark-small'], 0.97));

// ---------- Inline art for the interface (ink follows the theme via currentColor) ----------

const themed = (body) =>
  body
    .replaceAll(`fill="${NAVY}"`, 'fill="currentColor"')
    .replaceAll(`stroke="${NAVY}"`, 'stroke="currentColor"');
const lockupThemed = themed(lockup(marks.mark, NAVY)).trim();
const markThemed = themed(svg('0 0 96 96', marks.mark)).trim();
write(
  `${root}packages/ui/src/brand/art.ts`,
  `// Generated by brand/build.mjs: do not edit. Ink follows the text colour (currentColor).\n` +
    `export const LOCKUP_SVG = ${JSON.stringify(lockupThemed)};\n` +
    `export const MARK_SVG = ${JSON.stringify(markThemed)};\n`,
);
console.log(
  `Brand: ${Object.keys(files).length} SVGs in brand/, icons for the extension and desktop app.`,
);
