import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME, DARK, LIGHT, contrastRatio } from '@showsteps/core';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const css = readFileSync(join(root, 'packages/ui/src/tokens.css'), 'utf8');

/** `--ss-name: #rrggbb` declarations in one CSS block. */
function block(selectorStart: string): Record<string, string> {
  const at = css.indexOf(selectorStart);
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  return Object.fromEntries(
    [...body.matchAll(/--ss-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [
      m[1],
      (m[2] ?? '').toUpperCase(),
    ]),
  );
}
const kebab = (k: string) => k.replace(/[A-Z0-9]+/g, (m) => `-${m.toLowerCase()}`);

const light = block(':root {');
const dark = block(":root[data-theme='dark']");

describe('design tokens', () => {
  it('match the TypeScript copy used by exports and content scripts', () => {
    for (const [k, v] of Object.entries(LIGHT)) expect(light[kebab(k)], k).toBe(v);
    for (const [k, v] of Object.entries(DARK)) expect(dark[kebab(k)], `dark ${k}`).toBe(v);
    for (const [k, v] of Object.entries(CHROME))
      expect(light[`chrome-${kebab(k)}`], `chrome ${k}`).toBe(v);
  });

  it('keep the system-dark block identical to the explicit dark theme', () => {
    const at = css.indexOf('@media (prefers-color-scheme: dark)');
    const media = css.slice(at, css.indexOf(":root[data-theme='dark']"));
    for (const [k, v] of Object.entries(dark))
      expect(media.toUpperCase()).toContain(`--SS-${k.toUpperCase()}: ${v}`);
  });
});

describe('contrast (WCAG AA)', () => {
  const ratio = (a: string, b: string) => Math.round(contrastRatio(a, b) * 10) / 10;

  it('hits the documented values', () => {
    expect(ratio(LIGHT.text, LIGHT.bg)).toBeCloseTo(17.6, 0);
    expect(ratio(LIGHT.textMuted, LIGHT.bg)).toBeCloseTo(6.4, 0);
    expect(ratio(LIGHT.onAccent, LIGHT.accent)).toBeCloseTo(5.2, 0);
    expect(ratio(LIGHT.onSignal, LIGHT.signal)).toBeCloseTo(5.2, 0);
    expect(ratio(LIGHT.inputBorder, LIGHT.surface)).toBeGreaterThanOrEqual(3.4);
    expect(ratio(DARK.accent, DARK.bg)).toBeGreaterThanOrEqual(6);
  });

  for (const [name, t] of [
    ['light', LIGHT],
    ['dark', DARK],
  ] as const) {
    it(`text pairs are at least 4.5:1 (${name})`, () => {
      const pairs: [string, string, string][] = [
        ['text on bg', t.text, t.bg],
        ['text on surface', t.text, t.surface],
        ['text on surface-2', t.text, t.surface2],
        ['muted on bg', t.textMuted, t.bg],
        ['muted on surface', t.textMuted, t.surface],
        ['muted on surface-2', t.textMuted, t.surface2],
        ['on-accent on accent', t.onAccent, t.accent],
        ['on-accent on accent-hover', t.onAccent, t.accentHover],
        ['accent (links) on bg', t.accent, t.bg],
        ['accent (links) on surface', t.accent, t.surface],
        ['on-signal on signal', t.onSignal, t.signal],
        ['tip on surface', t.tip, t.surface],
        ['note on surface', t.note, t.surface],
        ['warning on surface', t.warning, t.surface],
        ['alert on surface', t.alert, t.surface],
      ];
      if (name === 'light') {
        const l = t as typeof LIGHT;
        pairs.push(
          ['tip on tip-bg', l.tip, l.tipBg],
          ['note on note-bg', l.note, l.noteBg],
          ['warning on warning-bg', l.warning, l.warningBg],
          ['alert on alert-bg', l.alert, l.alertBg],
          ['text on tone backgrounds', l.text, l.warningBg],
        );
      }
      for (const [label, fg, bg] of pairs)
        expect(contrastRatio(fg, bg), `${label}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });

    it(`boundaries are at least 3:1 (${name})`, () => {
      for (const [label, fg, bg] of [
        ['input border on surface', t.inputBorder, t.surface],
        ['input border on bg', t.inputBorder, t.bg],
        ['focus ring on bg', t.focus, t.bg],
        ['focus ring on surface', t.focus, t.surface],
        ['highlight on surface', t.signal, t.surface],
      ] as const)
        expect(contrastRatio(fg, bg), `${label}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
    });
  }

  it('controls over other apps read on navy', () => {
    for (const [label, fg, bg] of [
      ['fg', CHROME.fg, CHROME.bg],
      ['muted', CHROME.muted, CHROME.bg],
      ['step label', CHROME.step, CHROME.bg],
      ['on-signal', CHROME.onSignal, CHROME.signal],
      ['fg on button', CHROME.fg, CHROME.buttonHover],
    ] as const)
      expect(contrastRatio(fg, bg), label).toBeGreaterThanOrEqual(4.5);
  });
});

describe('no hard-coded colours', () => {
  // Colours live in tokens.css (and its TypeScript copy), brand artwork and the patterns.
  const allowed = new Set([
    'packages/ui/src/tokens.css',
    'packages/core/src/tokens.ts',
    'packages/core/src/patterns.ts',
    'packages/ui/src/brand/art.ts',
  ]);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'dist', '.output', '.wxt', 'test', 'public', 'release'].includes(name))
        continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|css|html)$/.test(name) && !name.endsWith('.d.ts')) files.push(p);
    }
  };
  walk(join(root, 'apps'));
  walk(join(root, 'packages'));

  it('appear only in tokens, brand files and patterns', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(root, file).replaceAll('\\', '/');
      if (allowed.has(rel)) continue;
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (
          /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b(?![-\w])|rgba?\(\s*\d/i.test(line) &&
          !/^\s*(\/\/|\/?\*)/.test(line)
        )
          offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
