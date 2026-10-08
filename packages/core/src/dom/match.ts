import type { Rect, Selector, SelectorType, Target } from '../schema.js';
import {
  getAccessibleName,
  getRole,
  isFormControl,
  labelText,
  normalizeText,
  tagOf,
  visibleText,
} from './aria.js';
import { deepElements, resolveXPath } from './traverse.js';

export type MatchStrategy = Exclude<SelectorType, 'uia'> | 'neighbourhood';

export interface MatchOptions {
  /** Element geometry; defaults to getBoundingClientRect. Injected by tests and frame-aware callers. */
  getRect?: (el: Element) => Rect;
  /** Visibility filter; defaults to "not inside a [hidden] subtree". */
  isVisible?: (el: Element) => boolean;
  /** Results below this confidence are discarded. Default 0.25. */
  minConfidence?: number;
}

export interface MatchResult {
  element: Element;
  strategy: MatchStrategy;
  /** 0..1, how sure the matcher is that this is the recorded element. */
  confidence: number;
  /** More than one element fitted and the matcher had to pick one. */
  ambiguous: boolean;
}

export const TESTID_ATTRS = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-qa',
  'data-cy',
] as const;

/** Strategy order and base confidence for a unique hit. */
export const STRATEGY_ORDER: readonly Exclude<MatchStrategy, 'neighbourhood'>[] = [
  'testid',
  'aria',
  'label',
  'text',
  'css',
  'xpath',
];
const BASE: Record<MatchStrategy, number> = {
  testid: 0.97,
  aria: 0.92,
  label: 0.88,
  text: 0.78,
  css: 0.62,
  xpath: 0.45,
  neighbourhood: 0.5,
};

export const formatAria = (role: string, name: string) => `${role} "${name}"`;

export function parseAria(value: string): { role: string; name: string } | undefined {
  const m = /^(\S+) "([\s\S]*)"$/.exec(value);
  const [, role, name] = m ?? [];
  return role !== undefined && name !== undefined ? { role, name } : undefined;
}

const eq = (a: string | undefined | null, b: string) =>
  !!a && normalizeText(a).toLowerCase() === normalizeText(b).toLowerCase();

const defaultRect = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};
/** Default visibility for documents without layout: hidden subtrees and closed dialogs are out. */
export const defaultVisible = (el: Element) => !el.closest('[hidden], dialog:not([open])');

/** Resolve the shadow-root scope recorded in `shadowHosts`, starting from `root`. */
export function resolveScope(
  root: Document | ShadowRoot,
  hosts: readonly string[] | undefined,
): Document | ShadowRoot | null {
  let scope: Document | ShadowRoot = root;
  for (const sel of hosts ?? []) {
    let host: Element | null;
    try {
      host = scope.querySelector(sel);
    } catch {
      return null;
    }
    if (!host?.shadowRoot) return null;
    scope = host.shadowRoot;
  }
  return scope;
}

/** Keep only elements with no matching descendant (the innermost match). */
function innermost(els: Element[]): Element[] {
  return els.filter((el) => !els.some((other) => other !== el && el.contains(other)));
}

/** Elements matching one selector. `all` is the visible deep element list of the root. */
export function runSelector(
  root: Document | ShadowRoot,
  all: Element[],
  sel: Pick<Selector, 'type' | 'value'>,
  target: Partial<Target> = {},
): Element[] {
  const v = sel.value;
  switch (sel.type) {
    case 'testid':
      return all.filter((e) => TESTID_ATTRS.some((a) => e.getAttribute(a) === v));
    case 'aria': {
      const parsed = parseAria(v);
      if (!parsed) return [];
      return all.filter((e) => getRole(e) === parsed.role && eq(getAccessibleName(e), parsed.name));
    }
    case 'label':
      return all.filter(
        (e) => isFormControl(e) && (eq(labelText(e), v) || eq(getAccessibleName(e), v)),
      );
    case 'text':
      return innermost(all.filter((e) => eq(visibleText(e), v)));
    case 'css': {
      const scope = resolveScope(root, target.shadowHosts);
      if (!scope) return [];
      try {
        const set = new Set(all);
        return Array.from(scope.querySelectorAll(v)).filter((e) => set.has(e));
      } catch {
        return [];
      }
    }
    case 'xpath': {
      const scope = resolveScope(root, target.shadowHosts);
      const el = scope ? resolveXPath(scope, v) : null;
      return el && all.includes(el) ? [el] : [];
    }
    default:
      return [];
  }
}

/** Selectors to try, in strategy order, synthesised from the target's fields when missing. */
export function selectorsFor(target: Partial<Target>): Selector[] {
  const list: Selector[] = [...(target.selectors ?? [])];
  const has = (type: SelectorType) => list.some((s) => s.type === type);
  if (target.testId && !has('testid'))
    list.push({ type: 'testid', value: target.testId, score: 0.9 });
  if (target.role && target.name && !has('aria')) {
    list.push({ type: 'aria', value: formatAria(target.role, target.name), score: 0.8 });
  }
  if (target.label && !has('label')) list.push({ type: 'label', value: target.label, score: 0.8 });
  if (target.text && !has('text') && target.text.length <= 80) {
    list.push({ type: 'text', value: target.text, score: 0.6 });
  }
  return list
    .filter((s) => s.type !== 'uia')
    .sort(
      (a, b) =>
        STRATEGY_ORDER.indexOf(a.type as never) - STRATEGY_ORDER.indexOf(b.type as never) ||
        b.score - a.score,
    );
}

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

function distance(a: Rect, b: Rect): number {
  const ca = centre(a);
  const cb = centre(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

/** Dice coefficient over character bigrams: 1 for identical strings, 0 for nothing shared. */
export function textSimilarity(a: string, b: string): number {
  const x = normalizeText(a).toLowerCase();
  const y = normalizeText(b).toLowerCase();
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const gx = grams(x);
  const gy = grams(y);
  let overlap = 0;
  for (const [g, n] of gx) overlap += Math.min(n, gy.get(g) ?? 0);
  const total = Math.max(1, x.length - 1 + (y.length - 1));
  return (2 * overlap) / total;
}

/** Narrow several candidates using the target's other recorded facts. */
function narrow(cands: Element[], target: Partial<Target>): Element[] {
  let out = cands;
  const keep = (pred: (e: Element) => boolean) => {
    const next = out.filter(pred);
    if (next.length) out = next;
  };
  if (target.tag) keep((e) => tagOf(e) === target.tag);
  if (target.role) keep((e) => getRole(e) === target.role);
  const { name, text } = target;
  if (name) keep((e) => eq(getAccessibleName(e), name));
  if (text) keep((e) => eq(visibleText(e), text));
  return out;
}

function closestTo(
  cands: Element[],
  target: Partial<Target>,
  getRect: (e: Element) => Rect,
): Element {
  const bbox = target.bbox;
  if (!bbox) return cands[0] as Element;
  return cands.reduce((best, e) =>
    distance(getRect(e), bbox) < distance(getRect(best), bbox) ? e : best,
  );
}

/** Last resort: same kind of element near the recorded position with similar text. */
function neighbourhood(
  all: Element[],
  target: Partial<Target>,
  getRect: (e: Element) => Rect,
): MatchResult | null {
  const wanted = target.name ?? target.text ?? target.label ?? target.ocrText ?? '';
  let best: { el: Element; score: number } | null = null;
  for (const el of all) {
    if (target.tag && tagOf(el) !== target.tag) continue;
    if (target.role && getRole(el) !== target.role) continue;
    const sim = wanted
      ? Math.max(
          textSimilarity(wanted, getAccessibleName(el)),
          textSimilarity(wanted, visibleText(el)),
        )
      : 0;
    let proximity = 0;
    if (target.bbox) {
      const r = getRect(el);
      if (r.w > 0 || r.h > 0) proximity = 1 / (1 + distance(r, target.bbox) / 150);
    }
    const score = wanted ? sim * 0.65 + proximity * 0.35 : proximity;
    if (!best || score > best.score) best = { el, score };
  }
  if (!best || best.score < 0.45) return null;
  return {
    element: best.el,
    strategy: 'neighbourhood',
    confidence: Math.min(BASE.neighbourhood, BASE.neighbourhood * best.score + 0.1),
    ambiguous: true,
  };
}

/**
 * Find the element a recorded target refers to. Strategies run in order (test id, role and
 * name, label, text, CSS, XPath, neighbourhood); the first unique hit wins. Ambiguous hits are
 * narrowed by the target's other facts, then by distance to the recorded position.
 */
export function findTarget(
  root: Document | ShadowRoot,
  target: Partial<Target>,
  opts: MatchOptions = {},
): MatchResult | null {
  const getRect = opts.getRect ?? defaultRect;
  const isVisible = opts.isVisible ?? defaultVisible;
  const minConfidence = opts.minConfidence ?? 0.25;
  const all = deepElements(root).filter(isVisible);

  // A hit whose tag differs from the recorded one (e.g. a heading with the button's text) is
  // only a fallback: later strategies still get a chance to find the real element.
  const tagMatches = (e: Element) => !target.tag || tagOf(e) === target.tag;
  let fallback: MatchResult | null = null;
  const offerFallback = (r: MatchResult) => {
    if (!fallback || r.confidence > fallback.confidence) fallback = r;
  };

  for (const sel of selectorsFor(target)) {
    const strategy = sel.type as MatchStrategy;
    const hits = runSelector(root, all, sel, target);
    if (hits.length === 0) continue;
    const narrowed = hits.length === 1 ? hits : narrow(hits, target);
    const [only] = narrowed;
    if (narrowed.length === 1 && only) {
      const element = only;
      const confidence = BASE[strategy] * (hits.length === 1 ? 1 : 0.9);
      if (tagMatches(element)) return { element, strategy, confidence, ambiguous: false };
      offerFallback({ element, strategy, confidence: confidence * 0.6, ambiguous: false });
      continue;
    }
    const element = closestTo(narrowed, target, getRect);
    offerFallback({
      element,
      strategy,
      confidence: BASE[strategy] * 0.6 * (tagMatches(element) ? 1 : 0.6),
      ambiguous: true,
    });
  }
  const near = neighbourhood(all, target, getRect);
  const best = [fallback as MatchResult | null, near]
    .filter((r): r is MatchResult => !!r)
    .sort((a, b) => b.confidence - a.confidence)[0];
  return best && best.confidence >= minConfidence ? best : null;
}

export interface WaitOptions extends MatchOptions {
  timeoutMs?: number;
  /** Polling interval for changes a MutationObserver cannot see (e.g. inside shadow roots). */
  pollMs?: number;
  signal?: AbortSignal;
}

/**
 * Like findTarget, but waits up to `timeoutMs` for the element to appear, re-checking on DOM
 * mutations and on a short poll. Resolves null on timeout or abort.
 */
export function waitForTarget(
  root: Document | ShadowRoot,
  target: Partial<Target>,
  opts: WaitOptions = {},
): Promise<MatchResult | null> {
  const { timeoutMs = 10_000, pollMs = 250, signal, ...matchOpts } = opts;
  const doc = (root.nodeType === 9 ? root : root.ownerDocument) as Document;
  const view = doc.defaultView;
  return new Promise((resolve) => {
    const first = findTarget(root, target, matchOpts);
    if (first || timeoutMs <= 0 || signal?.aborted) return resolve(first);

    let done = false;
    const finish = (result: MatchResult | null) => {
      if (done) return;
      done = true;
      observer?.disconnect();
      clearInterval(poll);
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const check = () => {
      const r = findTarget(root, target, matchOpts);
      if (r) finish(r);
    };
    const onAbort = () => finish(null);

    const Observer = view?.MutationObserver;
    const observer = Observer ? new Observer(check) : undefined;
    observer?.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    const poll = setInterval(check, pollMs);
    const timer = setTimeout(() => finish(findTarget(root, target, matchOpts)), timeoutMs);
    signal?.addEventListener('abort', onAbort);
  });
}
