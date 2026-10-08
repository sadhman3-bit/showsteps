import { tagOf } from './aria.js';

/** A document, shadow root or element to search within. */
export type SearchRoot = Document | ShadowRoot | Element;

const DOCUMENT_NODE = 9;
const FRAGMENT_NODE = 11;

/** Every element under `root`, descending into open shadow roots, in document order. */
export function deepElements(root: SearchRoot): Element[] {
  const out: Element[] = [];
  const visit = (parent: ParentNode) => {
    for (const child of Array.from(parent.children)) {
      out.push(child);
      if (child.shadowRoot) visit(child.shadowRoot);
      visit(child);
    }
  };
  visit(root);
  return out;
}

/** Shadow hosts enclosing `el`, outermost first. */
export function shadowHosts(el: Element): Element[] {
  const hosts: Element[] = [];
  let node: Node = el.getRootNode();
  while (node.nodeType === FRAGMENT_NODE && (node as ShadowRoot).host) {
    const host = (node as ShadowRoot).host;
    hosts.unshift(host);
    node = host.getRootNode();
  }
  return hosts;
}

/** The document or shadow root that directly contains `el`. */
export function scopeOf(el: Element): Document | ShadowRoot {
  const root = el.getRootNode();
  return (
    root.nodeType === DOCUMENT_NODE || root.nodeType === FRAGMENT_NODE ? root : el.ownerDocument
  ) as Document | ShadowRoot;
}

export function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ');
}

/** Attributes that are meaningful and usually stable. IDs and classes are deliberately excluded. */
const STABLE_ATTRS = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-qa',
  'data-cy',
  'name',
  'aria-label',
  'placeholder',
  'title',
  'alt',
  'for',
  'role',
  'type',
  'href',
  'value',
] as const;

function stableAttrSelector(el: Element): string | undefined {
  const tag = tagOf(el);
  const parts: string[] = [];
  for (const attr of STABLE_ATTRS) {
    const v = el.getAttribute(attr);
    if (!v || v.length > 80) continue;
    if (
      attr === 'value' &&
      !(tag === 'input' && ['radio', 'checkbox'].includes(el.getAttribute('type') ?? ''))
    ) {
      continue;
    }
    if (attr === 'href' && (v.startsWith('javascript:') || v === '#')) continue;
    parts.push(`[${attr}="${cssEscape(v)}"]`);
    if (parts.length === 2) break;
  }
  return parts.length ? `${tag}${parts.join('')}` : undefined;
}

function nthOfType(el: Element): string {
  const tag = tagOf(el);
  const parent = el.parentElement;
  if (!parent) return tag;
  const same = Array.from(parent.children).filter((c) => tagOf(c) === tag);
  return same.length === 1 ? tag : `${tag}:nth-of-type(${same.indexOf(el) + 1})`;
}

function countIn(scope: Document | ShadowRoot, selector: string): number {
  try {
    return scope.querySelectorAll(selector).length;
  } catch {
    return Infinity;
  }
}

/**
 * A CSS selector for `el` within its own document or shadow root, built from stable attributes
 * and structural positions only (never IDs or class names, which are often generated).
 */
export function cssPath(el: Element): string {
  const scope = scopeOf(el);
  const own = stableAttrSelector(el);
  if (own && countIn(scope, own) === 1) return own;

  const segments: string[] = [];
  let node: Element | null = el;
  while (node) {
    const attrSel: string | undefined = stableAttrSelector(node);
    segments.unshift(node === el && attrSel ? attrSel : nthOfType(node));
    const candidate = segments.join(' > ');
    if (countIn(scope, candidate) === 1) return candidate;
    if (node !== el && attrSel) {
      const anchored = [attrSel, ...segments.slice(1)].join(' > ');
      if (countIn(scope, anchored) === 1) return anchored;
    }
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    node = parent;
  }
  return segments.join(' > ');
}

/** Positional XPath from the element's document or shadow root, e.g. /html[1]/body[1]/button[2]. */
export function xpathOf(el: Element): string {
  const steps: string[] = [];
  let node: Element | null = el;
  while (node) {
    const tag = tagOf(node);
    const parent: Element | null = node.parentElement;
    const siblings: Element[] = parent
      ? Array.from(parent.children)
      : Array.from((node.parentNode as ParentNode | null)?.children ?? [node]);
    const index = siblings.filter((s) => tagOf(s) === tag).indexOf(node) + 1;
    steps.unshift(`${tag}[${index}]`);
    node = parent;
  }
  return `/${steps.join('/')}`;
}

/** Resolve a positional XPath produced by `xpathOf` within a document or shadow root. */
export function resolveXPath(scope: Document | ShadowRoot, path: string): Element | null {
  const steps = path.split('/').filter(Boolean);
  let candidates: Element[] = Array.from(scope.children);
  let current: Element | null = null;
  for (const step of steps) {
    const m = /^([a-z0-9-]+)\[(\d+)\]$/i.exec(step);
    if (!m) return null;
    const [, tag = '', n] = m;
    const matches = candidates.filter((c) => tagOf(c) === tag.toLowerCase());
    current = matches[Number(n) - 1] ?? null;
    if (!current) return null;
    candidates = Array.from(current.children);
  }
  return current;
}

/** Selector identifying an <iframe> within its parent document. */
export function frameSelector(iframe: Element): string {
  for (const attr of ['title', 'name', 'aria-label']) {
    const v = iframe.getAttribute(attr);
    if (v) return `iframe[${attr}="${cssEscape(v)}"]`;
  }
  const src = iframe.getAttribute('src');
  if (src) {
    try {
      const path = new URL(src, iframe.ownerDocument.baseURI).pathname;
      if (path && path !== '/') return `iframe[src*="${cssEscape(path)}"]`;
    } catch {
      // fall through to a structural path
    }
  }
  return cssPath(iframe);
}
