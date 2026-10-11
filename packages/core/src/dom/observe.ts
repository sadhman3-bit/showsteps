// U6: what changed on the page after an action, recorded as the step's expected result.
// A small snapshot before the action and another about 800 ms after are compared: the address,
// open dialogs, headings, and alert or status messages.
import type { Expectation } from '../schema.js';
import { getAccessibleName, getRole } from './aria.js';

export interface PageState {
  url: string;
  /** "dialog|Review invoice" for each open dialog, heading, alert or status. */
  landmarks: string[];
  /** Text of alerts and status messages. */
  messages: string[];
}

const WATCHED = new Set(['dialog', 'alertdialog', 'heading', 'alert', 'status']);
/** Cheap enough to run on every click: elements that can have a watched role. */
const CANDIDATES = [
  'dialog',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'output',
  ...[...WATCHED].map((r) => `[role="${r}"]`),
].join(', ');
const MAX_TEXT = 80;

const isShown = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  return !el.checkVisibility || el.checkVisibility({ visibilityProperty: true });
};

/** The parts of the page an action usually changes (light DOM of the document). */
export function pageState(doc: Document): PageState {
  const landmarks: string[] = [];
  const messages: string[] = [];
  for (const el of Array.from(doc.querySelectorAll(CANDIDATES))) {
    const role = getRole(el);
    if (!role || !WATCHED.has(role) || !isShown(el)) continue;
    const name = getAccessibleName(el).trim().slice(0, MAX_TEXT);
    landmarks.push(`${role}|${name}`);
    if (role === 'alert' || role === 'status') {
      // The first line is the message itself ("Invoice submitted"), not its links.
      const rendered = (el as HTMLElement).innerText ?? el.textContent ?? '';
      const first = rendered
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .find(Boolean);
      if (first) messages.push(first.slice(0, MAX_TEXT));
    }
  }
  return { url: doc.location?.href ?? '', landmarks, messages };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Expectations from the difference between two snapshots, most telling first: a new address,
 * a dialog that opened or closed, a new message, a new heading. At most three.
 */
export function expectationsFrom(
  before: PageState,
  after: PageState,
  opts: { inFrame?: boolean } = {},
): Expectation[] {
  if (opts.inFrame) {
    // Inside an iframe: its address is its own business; the rest is checked in that frame.
    return expectationsFrom({ ...before, url: '' }, { ...after, url: '' })
      .filter((e) => e.type !== 'url')
      .map((e) => ({ ...e, inFrame: true }));
  }
  const out: Expectation[] = [];
  const path = (u: string) => {
    try {
      const url = new URL(u);
      return url.pathname + url.hash;
    } catch {
      return u;
    }
  };
  if (path(before.url) !== path(after.url) && after.url)
    out.push({ type: 'url', matches: `${escapeRegExp(path(after.url))}$` });
  const had = new Set(before.landmarks);
  const has = new Set(after.landmarks);
  const target = (key: string) => {
    const [role, ...rest] = key.split('|');
    const name = rest.join('|');
    return { role: role ?? '', ...(name ? { name } : {}) };
  };
  for (const key of after.landmarks)
    if (!had.has(key) && /^(?:alert)?dialog\|/.test(key))
      out.push({ type: 'visible', target: target(key) });
  for (const key of before.landmarks)
    if (!has.has(key) && /^(?:alert)?dialog\|/.test(key))
      out.push({ type: 'hidden', target: target(key) });
  const oldMessages = new Set(before.messages);
  for (const m of after.messages) if (!oldMessages.has(m)) out.push({ type: 'text', contains: m });
  // A new heading, unless it only repeats a dialog's name.
  const dialogs = new Set(
    after.landmarks.filter((k) => /^(?:alert)?dialog\|/.test(k)).map((k) => k.split('|')[1]),
  );
  for (const key of after.landmarks)
    if (!had.has(key) && key.startsWith('heading|') && key.length > 8 && !dialogs.has(key.slice(8)))
      out.push({ type: 'visible', target: target(key) });
  return out.slice(0, 3);
}
