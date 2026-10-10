import type { Guide } from './schema.js';

/** Fonts offered for branding, with web-safe fallbacks (no font files are downloaded). */
export const BRAND_FONTS: Record<string, string> = {
  'Segoe UI': "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
  Calibri: 'Calibri, Carlito, sans-serif',
  Arial: 'Arial, Helvetica, sans-serif',
  Verdana: 'Verdana, Geneva, sans-serif',
  Georgia: 'Georgia, Cambria, serif',
  Cambria: 'Cambria, Georgia, serif',
};

/** Fonts with serifs, for exporters that map branding onto a built-in font family. */
export const SERIF_FONTS = new Set(['Georgia', 'Cambria']);

/** Trailmark's own accent and highlight colours, used when a guide has no branding. */
export const DEFAULT_ACCENT = '#0f6b62';
export const HIGHLIGHT_COLOR = '#c2410c';

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string | undefined): value is string {
  return !!value && HEX.test(value);
}

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

/** The guide's accent colour, or Trailmark's. */
export function accentOf(guide: Pick<Guide, 'branding'>): string {
  const accent = guide.branding?.accent;
  return isHexColor(accent) ? accent : DEFAULT_ACCENT;
}

/** The guide's branding font name if it is one Trailmark offers. */
export function fontOf(guide: Pick<Guide, 'branding'>): string | undefined {
  const f = guide.branding?.font;
  return f && BRAND_FONTS[f] ? f : undefined;
}
