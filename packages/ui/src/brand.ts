import type { Guide } from '@trailmark/core';

/** Fonts offered for branding, with web-safe fallbacks (no font files are downloaded). */
export const BRAND_FONTS: Record<string, string> = {
  'Segoe UI': "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
  Calibri: 'Calibri, Carlito, sans-serif',
  Arial: 'Arial, Helvetica, sans-serif',
  Verdana: 'Verdana, Geneva, sans-serif',
  Georgia: 'Georgia, Cambria, serif',
  Cambria: 'Cambria, Georgia, serif',
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Black or white text, whichever reads better on `hex`. */
export function textOn(hex: string): '#ffffff' | '#111111' {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? '#111111' : '#ffffff';
}

/** CSS variables that apply a guide's branding to the reader view (and exports). */
export function brandStyle(branding: Guide['branding']): Record<string, string> {
  const style: Record<string, string> = {};
  if (branding?.accent && HEX.test(branding.accent)) {
    style['--tm-accent'] = branding.accent;
    style['--tm-accent-hover'] = branding.accent;
    style['--tm-on-accent'] = textOn(branding.accent);
  }
  if (branding?.font && BRAND_FONTS[branding.font])
    style.fontFamily = BRAND_FONTS[branding.font] ?? '';
  return style;
}
