/**
 * ShowSteps colours for code that cannot read CSS variables: exports (HTML, PDF, Word), the
 * controls drawn over other web pages (they live in shadow roots), and picture highlights.
 * The same values as packages/ui/src/tokens.css; a test keeps the two in step.
 */
export const LIGHT = {
  bg: '#FFF8F9',
  surface: '#FFFFFF',
  surface2: '#F8EDF1',
  line: '#EFE3E8',
  inputBorder: '#8F87A6',
  text: '#14102B',
  textMuted: '#5E5878',
  accent: '#D9004C',
  accentHover: '#B8003F',
  onAccent: '#FFFFFF',
  signal: '#FF2E6E',
  onSignal: '#14102B',
  focus: '#FF2E6E',
  tip: '#0F7A55',
  tipBg: '#E9F6F0',
  note: '#3346C6',
  noteBg: '#EEF0FC',
  warning: '#8A5300',
  warningBg: '#FBF1E2',
  alert: '#B3261E',
  alertBg: '#FCEBEA',
} as const;

export const DARK = {
  bg: '#110D24',
  surface: '#1B1636',
  surface2: '#241E44',
  line: '#2D2750',
  inputBorder: '#6E6790',
  text: '#F5F2FF',
  textMuted: '#A9A3C7',
  accent: '#FF4D82',
  accentHover: '#FF6E98',
  onAccent: '#110D24',
  signal: '#FF4D82',
  onSignal: '#110D24',
  focus: '#FF4D82',
  tip: '#5BD6A0',
  note: '#9DA8FF',
  warning: '#F2B65A',
  alert: '#FF8A80',
} as const;

/** Controls shown over other apps (recording toolbar, step toast, Guide Me): both themes. */
export const CHROME = {
  bg: '#14102B',
  fg: '#F5F2FF',
  muted: '#A9A3C7',
  line: '#2D2750',
  button: '#2D2750',
  buttonHover: '#3A3363',
  signal: '#FF2E6E',
  onSignal: '#14102B',
  step: '#FF4D82',
} as const;

/** Picture annotation colours offered by the image editor, signal pink first. */
export const ANNOTATION_COLORS = ['#FF2E6E', '#14102B', '#FFFFFF', '#FFD166'] as const;

/** Guide Me spotlight: the page dims behind the target, which gets a pink ring and halo. */
export const SPOTLIGHT = {
  backdrop: 'rgb(17 13 36 / 0.45)',
  halo: 'rgb(255 46 110 / 0.18)',
} as const;

const camelToKebab = (s: string) => s.replace(/[A-Z0-9]+/g, (m) => `-${m.toLowerCase()}`);

/**
 * The chrome colours as CSS custom properties (`--ss-chrome-bg` …) for a shadow root's
 * `:host`, so content scripts use the same names as the extension's own pages.
 */
export function chromeTokenCss(): string {
  const vars = Object.entries(CHROME).map(([k, v]) => `--ss-chrome-${camelToKebab(k)}: ${v};`);
  vars.push(`--ss-spot-backdrop: ${SPOTLIGHT.backdrop};`, `--ss-spot-halo: ${SPOTLIGHT.halo};`);
  return vars.join(' ');
}
