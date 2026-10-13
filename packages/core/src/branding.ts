import type { Guide } from './schema.js';
import { CHROME, LIGHT } from './tokens.js';

/** Fonts offered for branding, with web-safe fallbacks (no font files are downloaded). */
export const BRAND_FONTS: Record<string, string> = {
  'Funnel Sans': "'Funnel Sans', 'Segoe UI', system-ui, sans-serif",
  'Segoe UI': "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
  Calibri: 'Calibri, Carlito, sans-serif',
  Arial: 'Arial, Helvetica, sans-serif',
  Verdana: 'Verdana, Geneva, sans-serif',
  Georgia: 'Georgia, Cambria, serif',
  Cambria: 'Cambria, Georgia, serif',
};

/** Fonts with serifs, for exporters that map branding onto a built-in font family. */
export const SERIF_FONTS = new Set(['Georgia', 'Cambria']);

/** ShowSteps's own accent ("Raspberry") and highlight ("Signal pink"), used without branding. */
export const DEFAULT_ACCENT = LIGHT.accent;
export const HIGHLIGHT_COLOR = LIGHT.signal;
/** Highlight drawn instead on pictures of pink or red interfaces, where pink would not show. */
export const HIGHLIGHT_ALT_COLOR = CHROME.bg;

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string | undefined): value is string {
  return !!value && HEX.test(value);
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Ink navy or white text, whichever has the higher contrast on `hex`. */
export function textOn(hex: string): '#FFFFFF' | '#14102B' {
  return contrastRatio(hex, '#FFFFFF') >= contrastRatio(hex, LIGHT.text) ? '#FFFFFF' : '#14102B';
}

/** The guide's accent colour, or ShowSteps's. */
export function accentOf(guide: Pick<Guide, 'branding'>): string {
  const accent = guide.branding?.accent;
  return isHexColor(accent) ? accent : DEFAULT_ACCENT;
}

/** The guide's branding font name if it is one ShowSteps offers. */
export function fontOf(guide: Pick<Guide, 'branding'>): string | undefined {
  const f = guide.branding?.font;
  return f && BRAND_FONTS[f] ? f : undefined;
}
