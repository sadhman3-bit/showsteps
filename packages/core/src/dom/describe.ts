import type { Point, Rect, Selector, Target } from '../schema.js';
import {
  getAccessibleName,
  getRole,
  isFormControl,
  labelText,
  normalizeText,
  tagOf,
  visibleText,
} from './aria.js';
import { TESTID_ATTRS, defaultVisible, formatAria, runSelector } from './match.js';
import { cssPath, deepElements, scopeOf, shadowHosts, xpathOf } from './traverse.js';

export interface DescribeOptions {
  /** Where the user clicked, in the same coordinate space as `getRect`. Defaults to the centre. */
  point?: Point;
  /** Selector chain from the top document to the frame holding the element (set by the caller). */
  frames?: string[];
  getRect?: (el: Element) => Rect;
}

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'slider',
  'spinbutton',
  'treeitem',
  'gridcell',
]);

/**
 * The element a user meant when an event landed on `el`: the nearest interactive ancestor
 * (e.g. the <button> around a clicked <span>), crossing shadow boundaries. Falls back to `el`.
 */
export function toActionable(el: Element): Element {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 8; depth++) {
    const tag = tagOf(node);
    if (isFormControl(node) || tag === 'button' || tag === 'summary') return node;
    if (tag === 'a' && node.hasAttribute('href')) return node;
    const role = node.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return node;
    if (tag === 'label') {
      // Clicking a label acts on its control; record the control.
      const control = labelControl(node);
      return control ?? node;
    }
    const parent: Element | null = node.parentElement;
    node = parent ?? ((node.getRootNode() as ShadowRoot).host || null);
  }
  return el;
}

function labelControl(label: Element): Element | null {
  const forId = label.getAttribute('for');
  if (forId) {
    const scope = scopeOf(label) as Document | ShadowRoot;
    return scope.getElementById?.(forId) ?? null;
  }
  return label.querySelector('input, select, textarea');
}

const round = (r: Rect): Rect => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  w: Math.round(r.w),
  h: Math.round(r.h),
});

const defaultRect = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};

/** Score multiplier by how many elements a selector matches: unique is best. */
function uniqueness(count: number): number {
  if (count <= 1) return 1;
  if (count === 2) return 0.55;
  return 0.3;
}

/**
 * Describe an element so it can be found again later, even after IDs and classes change:
 * role, accessible name, label, text and testid, plus ranked selectors scored by uniqueness.
 */
export function describeElement(el: Element, opts: DescribeOptions = {}): Target {
  const getRect = opts.getRect ?? defaultRect;
  const doc = el.ownerDocument;
  const all = deepElements(doc).filter(defaultVisible);
  if (!all.includes(el)) all.push(el);

  const tag = tagOf(el);
  const role = getRole(el);
  const name = getAccessibleName(el) || undefined;
  const label = labelText(el);
  const placeholder = normalizeText(el.getAttribute('placeholder')) || undefined;
  const text = isFormControl(el) ? undefined : visibleText(el).slice(0, 80) || undefined;
  const testIdAttr = TESTID_ATTRS.find((a) => el.hasAttribute(a));
  const testId = testIdAttr ? (el.getAttribute(testIdAttr) ?? undefined) : undefined;
  const hosts = shadowHosts(el).map((h) => cssPath(h));

  const base: Partial<Target> = { tag, role, name, shadowHosts: hosts.length ? hosts : undefined };
  const candidates: Omit<Selector, 'score'>[] = [];
  if (testId) candidates.push({ type: 'testid', value: testId });
  if (role && name) candidates.push({ type: 'aria', value: formatAria(role, name) });
  if (label) candidates.push({ type: 'label', value: label });
  if (text && text.length <= 50 && !isFormControl(el))
    candidates.push({ type: 'text', value: text });
  candidates.push({ type: 'css', value: cssPath(el) });
  candidates.push({ type: 'xpath', value: xpathOf(el) });

  const BASE_SCORE = {
    testid: 0.95,
    aria: 0.9,
    label: 0.85,
    text: 0.7,
    css: 0.5,
    xpath: 0.3,
    uia: 0.9,
  };
  const selectors: Selector[] = [];
  for (const c of candidates) {
    const hits = runSelector(doc, all, c, base);
    if (!hits.includes(el)) continue; // selector does not reach the element: useless
    selectors.push({
      ...c,
      score: Math.round(BASE_SCORE[c.type] * uniqueness(hits.length) * 100) / 100,
    });
  }

  const rect = round(getRect(el));
  const point = opts.point ?? {
    x: Math.round(rect.x + rect.w / 2),
    y: Math.round(rect.y + rect.h / 2),
  };

  const target: Target = { selectors, bbox: rect, point, tag };
  if (role) target.role = role;
  if (name) target.name = name;
  if (label) target.label = label;
  if (text) target.text = text;
  if (placeholder) target.placeholder = placeholder;
  if (testId) target.testId = testId;
  if (opts.frames?.length) target.frames = opts.frames;
  if (hosts.length) target.shadowHosts = hosts;
  return target;
}
