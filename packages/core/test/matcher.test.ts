import { afterAll, describe, expect, it } from 'vitest';
import { createStep } from '../src/factory.js';
import { toMarkdown } from '../src/richText.js';
import { writeStepTitle } from '../src/stepText.js';
import { describeElement, toActionable } from '../src/dom/describe.js';
import { findTarget, textSimilarity, waitForTarget } from '../src/dom/match.js';
import { frameSelector } from '../src/dom/traverse.js';
import { loadSnapshot, snapshotRect, truth, type Snapshot } from './helpers/snapshot.js';

const opened: Snapshot[] = [];
function open(name: string) {
  const s = loadSnapshot(name);
  opened.push(s);
  return s;
}
afterAll(async () => {
  await Promise.all(opened.map((s) => s.close()));
});

const opts = { getRect: snapshotRect };

/** Describe `key` in load "a", find it in load "b", and check it is the same element. */
function roundTrip(page: string, key: string) {
  const a = open(`${page}.a`);
  const b = open(`${page}.b`);
  const elA = truth(a.document, key);
  const target = describeElement(elA, opts);
  const found = findTarget(b.document, target, opts);
  const elB = truth(b.document, key);
  return { target, found, elA, elB };
}

const CASES: [page: string, keys: string[]][] = [
  ['login', ['username', 'password', 'sign-in']],
  [
    'dashboard',
    ['new-invoice', 'reports-link', 'new-invoice-link', 'cell-inv-1042', 'card-on-file'],
  ],
  [
    'new-invoice',
    [
      'supplier',
      'invoice-no',
      'amount',
      'currency',
      'invoice-date',
      'gst',
      'urgent',
      'cheque',
      'attach',
      'cost-centre',
      'approver-search',
      'approver-mei',
      'review',
    ],
  ],
  ['review', ['submit-invoice', 'back-to-edit']],
  ['frame-notes', ['note']],
  ['frame-widget', ['cc-select', 'cc-use']],
];

describe('matcher on demo-app snapshots (IDs and classes differ between loads)', () => {
  for (const [page, keys] of CASES) {
    for (const key of keys) {
      it(`${page}: finds "${key}" again`, () => {
        const { found, elB, target } = roundTrip(page, key);
        expect(found, JSON.stringify(target.selectors)).not.toBeNull();
        expect(found!.element).toBe(elB);
        expect(found!.ambiguous).toBe(false);
        expect(found!.confidence).toBeGreaterThanOrEqual(0.75);
      });
    }
  }

  it('the two loads really do have different IDs', () => {
    const a = truth(open('new-invoice.a').document, 'supplier');
    const b = truth(open('new-invoice.b').document, 'supplier');
    expect(a.id).not.toBe('');
    expect(a.id).not.toBe(b.id);
  });

  it('never builds CSS selectors from IDs or class names', () => {
    const doc = open('new-invoice.a').document;
    for (const key of CASES.find(([p]) => p === 'new-invoice')![1]) {
      const target = describeElement(truth(doc, key), opts);
      for (const s of target.selectors.filter((x) => x.type === 'css')) {
        const outsideQuotes = s.value.replace(/"(?:[^"\\]|\\.)*"/g, '""');
        expect(outsideQuotes).not.toMatch(/#|\.[a-z_-]/i);
      }
    }
  });
});

describe('target descriptors', () => {
  it('captures role, name, label and ranked selectors for a labelled input', () => {
    const t = describeElement(truth(open('new-invoice.a').document, 'invoice-no'), opts);
    expect(t).toMatchObject({
      tag: 'input',
      role: 'textbox',
      name: 'Invoice no.',
      label: 'Invoice no.',
    });
    expect(t.placeholder).toBe('e.g. INV-1043');
    expect(t.selectors[0]).toMatchObject({
      type: 'aria',
      value: 'textbox "Invoice no."',
      score: 0.9,
    });
    expect(t.selectors.map((s) => s.type)).toEqual(['aria', 'label', 'css', 'xpath']);
    expect(t.bbox.w).toBeGreaterThan(0);
  });

  it('prefers a test id when the page has one', () => {
    const t = describeElement(truth(open('dashboard.a').document, 'new-invoice'), opts);
    expect(t.testId).toBe('new-invoice');
    expect(t.selectors[0]).toMatchObject({ type: 'testid', value: 'new-invoice', score: 0.95 });
  });

  it('down-scores selectors that match several elements', () => {
    // "New invoice" is both a nav link and a button; role+name stays unique, text does not.
    const t = describeElement(truth(open('dashboard.a').document, 'new-invoice'), opts);
    const text = t.selectors.find((s) => s.type === 'text');
    expect(text?.score).toBeLessThan(0.7);
  });

  it('records the shadow host chain for elements inside a web component', () => {
    const t = describeElement(truth(open('new-invoice.a').document, 'approver-mei'), opts);
    expect(t.shadowHosts).toEqual(['tm-approver-picker']);
    expect(t).toMatchObject({ role: 'button', name: 'Mei Chen' });
  });

  it('builds frame selectors from stable iframe attributes', () => {
    const doc = open('new-invoice.a').document;
    const frames = Array.from(doc.querySelectorAll('iframe')).map(frameSelector);
    expect(frames).toEqual(['iframe[title="Cost centre lookup"]', 'iframe[title="Internal note"]']);
  });

  it('feeds the step-text writer', () => {
    const t = describeElement(truth(open('new-invoice.a').document, 'currency'), opts);
    const step = createStep({
      action: 'select',
      app: { kind: 'web', url: 'http://localhost:5173/app/invoices/new' },
      target: t,
      input: { mode: 'fixed', value: 'NZD', sensitive: false },
    });
    expect(toMarkdown(writeStepTitle(step))).toBe('Select **NZD** from **Currency**');
  });
});

describe('actionable element', () => {
  it('maps a click on inner content to the interactive ancestor', () => {
    const { document } = open('dashboard.a');
    const button = truth(document, 'new-invoice');
    const span = document.createElement('span');
    span.textContent = 'New invoice';
    button.textContent = '';
    button.appendChild(span);
    expect(toActionable(span)).toBe(button);
  });

  it('maps a click on a wrapping label to its control', () => {
    const { document } = open('new-invoice.a');
    const gst = truth(document, 'gst');
    expect(toActionable(gst.closest('label')!)).toBe(gst);
  });
});

describe('matcher fallbacks', () => {
  it('uses CSS when names change, and neighbourhood when structure changes too', () => {
    const a = open('new-invoice.a').document;
    const b = open('new-invoice.b').document;
    const target = describeElement(truth(a, 'review'), opts);
    // Rename the button in b: role+name and text no longer match.
    const reviewB = truth(b, 'review');
    reviewB.textContent = 'Review this invoice';
    const viaCss = findTarget(b, target, opts);
    expect(viaCss?.element).toBe(reviewB);
    expect(viaCss?.strategy).toBe('css');

    // Remove all structural selectors: only text similarity and position remain.
    const loose = { ...target, selectors: [] };
    const near = findTarget(b, loose, opts);
    expect(near?.element).toBe(reviewB);
    expect(near?.strategy).toBe('neighbourhood');
    expect(near?.confidence).toBeLessThanOrEqual(0.5);
  });

  it('breaks ties by position when a selector is ambiguous', () => {
    const b = open('dashboard.b').document;
    // Text "New invoice" matches the nav link and the button; position picks the button.
    const button = truth(b, 'new-invoice');
    const found = findTarget(
      b,
      {
        text: 'New invoice',
        bbox: snapshotRect(button),
        selectors: [{ type: 'text', value: 'New invoice', score: 0.5 }],
      },
      opts,
    );
    expect(found?.element).toBe(button);
    expect(found?.ambiguous).toBe(true);
  });

  it('returns null rather than guessing when nothing fits', () => {
    const b = open('login.b').document;
    expect(
      findTarget(
        b,
        {
          role: 'button',
          name: 'Delete everything',
          selectors: [],
          bbox: { x: 2000, y: 2000, w: 1, h: 1 },
        },
        opts,
      ),
    ).toBeNull();
  });

  it('scores text similarity', () => {
    expect(textSimilarity('Submit invoice', 'Submit invoice')).toBe(1);
    expect(textSimilarity('Submit invoice', 'Submit the invoice')).toBeGreaterThan(0.7);
    expect(textSimilarity('Submit', 'Cancel')).toBeLessThan(0.2);
    expect(textSimilarity('', 'x')).toBe(0);
  });
});

describe('waiting for targets', () => {
  it('resolves when the element appears later (slow section)', async () => {
    const { document, window } = open('dashboard.a');
    const target = describeElement(truth(document, 'cell-inv-1042'), opts);
    const table = truth(document, 'cell-inv-1042').closest('table')!;
    table.remove();
    const pending = waitForTarget(document, target, { ...opts, timeoutMs: 2000, pollMs: 50 });
    window.setTimeout(() => document.querySelector('[aria-live]')!.appendChild(table), 150);
    const found = await pending;
    expect(found?.element.textContent).toBe('INV-1042');
  });

  it('resolves null after the timeout', async () => {
    const { document } = open('login.a');
    const started = Date.now();
    const found = await waitForTarget(
      document,
      { role: 'button', name: 'Never appears', selectors: [] },
      { ...opts, timeoutMs: 200, pollMs: 50 },
    );
    expect(found).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(180);
  });

  it('stops when aborted', async () => {
    const { document } = open('login.a');
    const ctrl = new AbortController();
    const pending = waitForTarget(
      document,
      { role: 'button', name: 'Nope', selectors: [] },
      { timeoutMs: 5000, signal: ctrl.signal },
    );
    ctrl.abort();
    expect(await pending).toBeNull();
  });
});
