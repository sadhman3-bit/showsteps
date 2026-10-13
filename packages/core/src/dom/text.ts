// Visible text with word positions, saved next to each web screenshot for Secure Blur (E11).
import type { PageText, TextRun } from '../secure.js';
import { tagOf } from './aria.js';
import { isSensitiveField } from './sensitive.js';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas']);
const VALUE_TAGS = new Set(['input', 'textarea']);
const VALUE_TYPES = new Set(['', 'text', 'email', 'search', 'tel', 'url', 'number']);

export interface CollectOptions {
  /** Stop after this many words (a very long page keeps what is on screen first). */
  maxWords?: number;
  /** Elements to leave out, such as ShowSteps's own on-page UI. */
  skip?: (el: Element) => boolean;
}

/**
 * Words on screen in `doc`, with boxes in CSS pixels of the viewport. Descends into open
 * shadow roots. Values of ordinary inputs count as text; values of secret fields are never
 * read.
 */
export function collectPageText(doc: Document, options: CollectOptions = {}): PageText {
  const win = doc.defaultView;
  const width = win?.innerWidth ?? 0;
  const height = win?.innerHeight ?? 0;
  const maxWords = options.maxWords ?? 5000;
  const runs: TextRun[] = [];
  let count = 0;
  const range = doc.createRange();
  const onScreen = (r: { left: number; top: number; right: number; bottom: number }) =>
    r.right > 0 && r.bottom > 0 && r.left < width && r.top < height && r.right > r.left;
  const box = (r: DOMRect): [number, number, number, number] => [
    Math.round(r.left),
    Math.round(r.top),
    Math.round(r.width),
    Math.round(r.height),
  ];

  const textNode = (node: Text) => {
    const text = node.data;
    if (!/\S/.test(text)) return;
    // Hidden text is not in the picture.
    const parent = node.parentElement;
    if (
      parent?.checkVisibility &&
      !parent.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    )
      return;
    range.selectNodeContents(node);
    if (!onScreen(range.getBoundingClientRect())) return;
    const words: TextRun['words'] = [];
    for (const m of text.matchAll(/\S+/g)) {
      if (count >= maxWords) break;
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      // A word broken across lines has several boxes: keep each.
      for (const r of Array.from(range.getClientRects())) {
        if (!onScreen(r)) continue;
        words.push([m.index, m.index + m[0].length, ...box(r)]);
      }
      count++;
    }
    if (words.length) runs.push({ text, words });
  };

  const valueOf = (el: Element) => {
    const tag = tagOf(el);
    if (!VALUE_TAGS.has(tag) || isSensitiveField(el)) return;
    if (tag === 'input' && !VALUE_TYPES.has((el.getAttribute('type') ?? '').toLowerCase())) return;
    const value = (el as HTMLInputElement).value;
    if (!value || !/\S/.test(value)) return;
    const r = el.getBoundingClientRect();
    if (!onScreen(r)) return;
    // No per-word boxes inside a field: the whole field is the box.
    runs.push({ text: value, words: [[0, value.length, ...box(r)]] });
    count++;
  };

  const visit = (parent: Node) => {
    for (let child = parent.firstChild; child && count < maxWords; child = child.nextSibling) {
      if (child.nodeType === TEXT_NODE) {
        textNode(child as Text);
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) continue;
      const el = child as Element;
      if (SKIP_TAGS.has(tagOf(el)) || options.skip?.(el)) continue;
      if (VALUE_TAGS.has(tagOf(el))) {
        valueOf(el);
        continue;
      }
      if (el.shadowRoot) visit(el.shadowRoot);
      visit(el);
    }
  };
  if (doc.body) visit(doc.body);
  return { width, height, runs };
}
