import { BRAND_FONTS, isHexColor, textOn, type Guide } from '@showsteps/core';

export { BRAND_FONTS, textOn };

/** CSS variables that apply a guide's branding to the reader view (and exports). */
export function brandStyle(branding: Guide['branding']): Record<string, string> {
  const style: Record<string, string> = {};
  const accent = branding?.accent;
  if (isHexColor(accent)) {
    style['--ss-accent'] = accent;
    style['--ss-accent-hover'] = accent;
    style['--ss-on-accent'] = textOn(accent);
  }
  if (branding?.font && BRAND_FONTS[branding.font])
    style.fontFamily = BRAND_FONTS[branding.font] ?? '';
  return style;
}
