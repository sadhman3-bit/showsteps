import { chromeTokenCss } from '@showsteps/core';

/**
 * Shared look of the controls ShowSteps draws over web pages (capture toolbar, step toast,
 * Guide Me). They live in shadow roots, so the colours arrive as CSS variables from the same
 * tokens as the extension's own pages. They use the system's interface font: content scripts
 * load in every frame of every recorded page, so they carry no font files.
 */
export const CHROME_FONT = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";

export const CHROME_BASE_CSS = `
:host { all: initial; ${chromeTokenCss()} font: 14px/20px ${CHROME_FONT}; color: var(--ss-chrome-fg);
  -webkit-font-smoothing: antialiased; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
.icon { display: block; flex: none; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;
