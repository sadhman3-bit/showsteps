import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import type { Rect } from '../../src/schema.js';

const DIR = new URL('../fixtures/demo/', import.meta.url);

export type Snapshot = { window: Window; document: Document; close: () => Promise<void> };

/** Turn <template data-ss-shadow> back into open shadow roots (happy-dom lacks declarative shadow DOM). */
function hydrateShadowRoots(root: ParentNode): void {
  for (const tpl of Array.from(root.querySelectorAll('template[data-ss-shadow]'))) {
    const host = tpl.parentElement;
    if (!host) continue;
    const html = tpl.innerHTML;
    tpl.remove();
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = html;
    hydrateShadowRoots(shadow);
  }
}

/** Load a demo snapshot (e.g. "new-invoice.a") into a fresh happy-dom window. */
export function loadSnapshot(name: string, url = 'http://localhost:5173/app/'): Snapshot {
  const html = readFileSync(new URL(`${name}.html`, DIR), 'utf8');
  const window = new Window({
    url,
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
    },
  });
  window.document.write(html);
  const document = window.document as unknown as Document;
  hydrateShadowRoots(document);
  return { window, document, close: () => window.happyDOM.close() };
}

/** Real Chromium layout, recorded in data-ss-rect when the snapshot was taken. */
export function snapshotRect(el: Element): Rect {
  const [x = 0, y = 0, w = 0, h = 0] = (el.getAttribute('data-ss-rect') ?? '')
    .split(',')
    .map(Number);
  return { x, y, w, h };
}

/** Find a ground-truth element anywhere, including inside shadow roots. */
export function truth(root: Document | ShadowRoot, key: string): Element {
  const direct = root.querySelector(`[data-ss-truth="${key}"]`);
  if (direct) return direct;
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (el.shadowRoot) {
      try {
        return truth(el.shadowRoot, key);
      } catch {
        // keep looking
      }
    }
  }
  throw new Error(`No ground-truth element "${key}"`);
}
