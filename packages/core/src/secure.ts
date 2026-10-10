// Secure Blur (E11): find sensitive values in the text shown on a screenshot and turn them into
// blur regions. Web steps keep the position of every visible word from capture time
// (`<stepId>.words.json` next to the picture); desktop and image steps get the same from OCR.
import { z } from 'zod';
import type { Guide, Rect, Step } from './schema.js';

/** One run of text (a DOM text node, an input's value or an OCR line) and its words' boxes. */
export const TextRunSchema = z.object({
  text: z.string(),
  /** [start, end, x, y, w, h]: a word's character range in `text` and its box in picture px. */
  words: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])),
});
export type TextRun = z.infer<typeof TextRunSchema>;

export const PageTextSchema = z.object({
  /** Picture size the boxes refer to. */
  width: z.number(),
  height: z.number(),
  runs: z.array(TextRunSchema),
});
export type PageText = z.infer<typeof PageTextSchema>;

/** Word positions stored next to a screenshot: "img/abc.webp" → "abc.words.json". */
export function wordsFileFor(screenshotFile: string): string {
  return `${screenshotFile.replace(/^img\//, '').replace(/\.[^.]+$/, '')}.words.json`;
}

/** Move and scale word boxes (frame offset, CSS → picture pixels) and set the picture size. */
export function scalePageText(
  page: PageText,
  scale: number,
  width: number,
  height: number,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): PageText {
  return {
    width,
    height,
    runs: page.runs.map((run) => ({
      text: run.text,
      words: run.words.map(([s, e, x, y, w, h]) => [
        s,
        e,
        Math.round((x + offset.x) * scale),
        Math.round((y + offset.y) * scale),
        Math.round(w * scale),
        Math.round(h * scale),
      ]),
    })),
  };
}

export function parsePageText(bytes: Uint8Array): PageText | undefined {
  try {
    const parsed = PageTextSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function serializePageText(page: PageText): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(page));
}

export type SensitiveKind =
  'email' | 'phone' | 'card' | 'bsb' | 'account' | 'tfn' | 'abn' | 'iban' | 'amount' | 'name';

export interface SensitiveMatch {
  kind: SensitiveKind;
  text: string;
  start: number;
  end: number;
}

export interface DetectOptions {
  /** Also find dollar (and other currency) amounts. */
  amounts?: boolean;
  /** People's names to find (whole words, any case). */
  names?: readonly string[];
}

const digitsOf = (s: string) => s.replace(/\D/g, '');

/** Luhn check for card numbers. */
export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length > 0 && sum % 10 === 0;
}

/** Australian Tax File Number check digit (8 or 9 digits). */
export function validTfn(digits: string): boolean {
  const weights =
    digits.length === 9
      ? [1, 4, 3, 7, 5, 8, 6, 9, 10]
      : digits.length === 8
        ? [10, 7, 8, 4, 6, 3, 5, 1]
        : undefined;
  if (!weights) return false;
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  return sum % 11 === 0;
}

/** Australian Business Number check (11 digits). */
export function validAbn(digits: string): boolean {
  if (digits.length !== 11) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = weights.reduce((acc, w, i) => acc + w * (Number(digits[i]) - (i === 0 ? 1 : 0)), 0);
  return sum % 89 === 0;
}

/** IBAN mod-97 check. */
export function validIban(raw: string): boolean {
  const iban = raw.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const n = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of n) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

const ACCOUNT_WORDS = /\b(?:acc(?:oun)?ts?|acct|a\/c)\b/i;
const BSB_WORD = /\bbsb\b/i;

interface Rule {
  kind: SensitiveKind;
  re: RegExp;
  check?: (text: string, context: string) => boolean;
}

/** In priority order: an earlier rule wins where two matches overlap. */
const RULES: Rule[] = [
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  {
    kind: 'iban',
    re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g,
    check: (t) => validIban(t),
  },
  {
    kind: 'card',
    re: /\b\d(?:[ -]?\d){12,18}\b/g,
    check: (t) => luhn(digitsOf(t)),
  },
  { kind: 'abn', re: /\b\d{2} ?\d{3} ?\d{3} ?\d{3}\b/g, check: (t) => validAbn(digitsOf(t)) },
  { kind: 'tfn', re: /\b\d{3} ?\d{3} ?\d{2,3}\b/g, check: (t) => validTfn(digitsOf(t)) },
  { kind: 'bsb', re: /\b\d{3}-\d{3}\b/g },
  {
    kind: 'phone',
    re: /(?:\+61[ -]?|\(0[2-8]\) ?|\b0)[2-478](?:[ -]?\d){8}\b|\b1[38]00(?:[ -]?\d){6}\b|\+\d{1,3}(?:[ -]?\d){7,12}\b/g,
  },
  { kind: 'bsb', re: /\b\d{3} ?\d{3}\b/g, check: (_t, context) => BSB_WORD.test(context) },
  {
    kind: 'account',
    re: /\b\d(?:[ -]?\d){5,9}\b/g,
    check: (_t, context) => ACCOUNT_WORDS.test(context),
  },
];

const AMOUNT_RULE: Rule = {
  kind: 'amount',
  re: /(?:[$€£]|\b(?:AUD|USD|NZD|EUR|GBP) ?)-?\d[\d,]*(?:\.\d{1,2})?\b/g,
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Find sensitive values in one run of text. `context` is the text just before it (a label
 * such as "Account number" in a neighbouring element), used for the values that only count
 * as sensitive next to such a word.
 */
export function detectSensitive(
  text: string,
  options: DetectOptions = {},
  context = '',
): SensitiveMatch[] {
  const rules = [...RULES];
  if (options.amounts) rules.push(AMOUNT_RULE);
  const names = (options.names ?? []).map((n) => n.trim()).filter((n) => n.length > 1);
  if (names.length)
    rules.push({
      kind: 'name',
      re: new RegExp(`\\b(?:${names.map(escapeRegExp).join('|')})\\b`, 'gi'),
    });
  const found: SensitiveMatch[] = [];
  const overlaps = (start: number, end: number) =>
    found.some((m) => start < m.end && end > m.start);
  for (const rule of rules) {
    for (const m of text.matchAll(rule.re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      const before = `${context} ${text.slice(Math.max(0, start - 40), start)}`;
      if (rule.check && !rule.check(m[0], before)) continue;
      found.push({ kind: rule.kind, text: m[0], start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export interface SensitiveFinding {
  /** Stable id for the review screen. */
  id: string;
  kind: SensitiveKind;
  text: string;
  /** Where to blur, in picture pixels (padded a little). */
  rect: Rect;
}

const PAD = 3;

/** Every sensitive value on one screenshot, with the box to blur. */
export function findSensitiveOnPage(
  page: PageText,
  options: DetectOptions = {},
): SensitiveFinding[] {
  const out: SensitiveFinding[] = [];
  page.runs.forEach((run, r) => {
    // A label usually sits in the element just before the value.
    const context = page.runs[r - 1]?.text ?? '';
    for (const m of detectSensitive(run.text, options, context)) {
      const boxes = run.words.filter(([s, e]) => s < m.end && e > m.start);
      if (!boxes.length) continue;
      const x1 = Math.min(...boxes.map((b) => b[2]));
      const y1 = Math.min(...boxes.map((b) => b[3]));
      const x2 = Math.max(...boxes.map((b) => b[2] + b[4]));
      const y2 = Math.max(...boxes.map((b) => b[3] + b[5]));
      const x = Math.max(0, Math.floor(x1 - PAD));
      const y = Math.max(0, Math.floor(y1 - PAD));
      out.push({
        id: `${r}:${m.start}`,
        kind: m.kind,
        text: m.text,
        rect: {
          x,
          y,
          w: Math.min(page.width, Math.ceil(x2 + PAD)) - x,
          h: Math.min(page.height, Math.ceil(y2 + PAD)) - y,
        },
      });
    }
  });
  return out;
}

/** "4111 1111 1111 1111" → "•••• 1111": enough to recognise a value on the review screen. */
export function maskValue(text: string): string {
  const visible = text.length <= 6 ? 1 : 4;
  return `${'•'.repeat(Math.min(8, Math.max(3, text.length - visible)))}${text.slice(-visible)}`;
}

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

/** Whether a step already blurs this region (so running Secure Blur twice adds nothing). */
export function alreadyBlurred(step: Step, rect: Rect): boolean {
  return step.human.blurs.some((b) => contains(b, rect));
}

/** Add the approved findings to their steps as blur regions. */
export function applySecureBlur(
  guide: Guide,
  approved: ReadonlyMap<string, readonly Rect[]>,
): Guide {
  return {
    ...guide,
    blocks: guide.blocks.map((b) => {
      const rects = b.kind === 'step' ? approved.get(b.id) : undefined;
      if (b.kind !== 'step' || !rects?.length) return b;
      const add = rects.filter((r) => !alreadyBlurred(b, r));
      return add.length ? { ...b, human: { ...b.human, blurs: [...b.human.blurs, ...add] } } : b;
    }),
  };
}
