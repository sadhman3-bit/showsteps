import { describe, expect, it } from 'vitest';
import { createCallout, createGuide, createHeading, createStep } from '../src/factory.js';
import {
  GuideFormatError,
  migrateRaw,
  parseGuide,
  serializeGuide,
  type Migration,
} from '../src/migrations.js';
import { plain, toHtml, toMarkdown } from '../src/richText.js';
import { GuideSchema, type Guide } from '../src/schema.js';

function sampleGuide(): Guide {
  return createGuide({
    title: 'Create an invoice',
    description: 'Enter a supplier invoice in Ledgerline.',
    tags: ['ap', 'invoices'],
    preconditions: ['Signed in to Ledgerline'],
    success: 'The confirmation page shows the invoice number.',
    apps: [{ kind: 'web', origin: 'http://localhost:5173' }],
    variables: [
      { name: 'invoice_number', label: 'Invoice number', example: 'INV-1043', sensitive: false },
      { name: 'card_number', label: 'Card number', sensitive: true },
    ],
    blocks: [
      createHeading('Open the form'),
      createStep({
        action: 'click',
        app: { kind: 'web', url: 'http://localhost:5173/app/' },
        target: {
          role: 'button',
          name: 'New invoice',
          testId: 'new-invoice',
          selectors: [{ type: 'testid', value: 'new-invoice', score: 0.95 }],
          bbox: { x: 10, y: 20, w: 100, h: 30 },
          point: { x: 60, y: 35 },
        },
        human: {
          title: plain('Click New invoice'),
          screenshot: { file: 'img/a.webp', width: 1280, height: 800, dpr: 1.5 },
          actionBox: { x: 5, y: 15, w: 110, h: 40 },
          annotations: [
            { id: 'a1', kind: 'arrow', from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, color: '#c2410c' },
            { id: 'a2', kind: 'badge', at: { x: 1, y: 1 }, number: 1, color: '#0f6b62' },
          ],
          blurs: [{ x: 1, y: 2, w: 3, h: 4 }],
        },
        agent: {
          expect: [{ type: 'url', matches: '/app/invoices/new$' }],
          confirm: false,
        },
        capture: { source: 'extension', tabId: 7 },
      }),
      createCallout('warning', 'Check the supplier ABN first.'),
      createStep({
        action: 'type',
        app: { kind: 'web', url: 'http://localhost:5173/app/invoices/new' },
        input: { mode: 'ask', variable: 'invoice_number', sensitive: false },
      }),
    ],
  });
}

describe('schema round-trips', () => {
  it('a full guide survives serialise → parse unchanged', () => {
    const guide = sampleGuide();
    const back = parseGuide(JSON.parse(serializeGuide(guide)));
    expect(back).toEqual(guide);
  });

  it('factory defaults are valid', () => {
    expect(GuideSchema.safeParse(createGuide()).success).toBe(true);
    const step = createStep({ action: 'manual', app: { kind: 'web', url: 'about:blank' } });
    expect(step.agent).toEqual({ timeoutMs: 10000, confirm: false, visualOnly: false });
  });

  it('rejects a sensitive input that carries a value', () => {
    const guide = sampleGuide();
    guide.blocks.push(
      createStep({
        action: 'type',
        app: { kind: 'web', url: 'http://x' },
        input: { mode: 'fixed', value: 'hunter2', sensitive: true },
      }),
    );
    expect(() => serializeGuide(guide)).toThrow(/Sensitive inputs must never store a value/);
  });

  it('rejects a sensitive variable with a default value', () => {
    const guide = sampleGuide();
    guide.variables.push({ name: 'pin', label: 'PIN', defaultValue: '1234', sensitive: true });
    expect(GuideSchema.safeParse(guide).success).toBe(false);
  });

  it('rejects duplicate block ids and unknown variables', () => {
    const guide = sampleGuide();
    guide.blocks.push({ ...guide.blocks[0]! });
    guide.blocks.push(
      createStep({
        action: 'type',
        app: { kind: 'web', url: 'http://x' },
        input: { mode: 'ask', variable: 'nope', sensitive: false },
      }),
    );
    try {
      parseGuide(JSON.parse(JSON.stringify(guide)));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(GuideFormatError);
      const details = (e as GuideFormatError).details.join('\n');
      expect(details).toMatch(/Duplicate block id/);
      expect(details).toMatch(/unknown variable "nope"/);
    }
  });

  it('rejects javascript: links in rich text', () => {
    const guide = sampleGuide();
    const step = guide.blocks[1];
    if (step?.kind !== 'step') throw new Error('fixture');
    step.human.title = { spans: [{ text: 'x', href: 'javascript:alert(1)' }] };
    expect(GuideSchema.safeParse(guide).success).toBe(false);
  });
});

describe('migrations', () => {
  const v0to1: Migration = {
    from: 0,
    describe: 'v0 stored steps under "steps"',
    up: (raw) => {
      const { steps, ...rest } = raw;
      return { ...rest, blocks: steps };
    },
  };

  it('applies registered migrations in order', () => {
    const out = migrateRaw({ title: 'Old', steps: [] }, [v0to1], 1);
    expect(out).toEqual({ title: 'Old', blocks: [], schemaVersion: 1 });
  });

  it('does not mutate its input', () => {
    const input = { title: 'Old', steps: [] };
    migrateRaw(input, [v0to1], 1);
    expect(input).toEqual({ title: 'Old', steps: [] });
  });

  it('passes current-version guides through', () => {
    const g = sampleGuide();
    expect(migrateRaw(g)).toBe(g);
  });

  it('refuses guides from a newer Trailmark with a friendly message', () => {
    expect(() => parseGuide({ ...sampleGuide(), schemaVersion: 99 })).toThrow(
      /newer version of Trailmark/,
    );
  });

  it('refuses when no upgrade path exists', () => {
    expect(() => migrateRaw({ title: 'Old' }, [], 1)).toThrow(/No upgrade path/);
  });

  it('refuses non-guides', () => {
    expect(() => parseGuide('hello')).toThrow(/not a Trailmark guide/);
    expect(() => parseGuide([])).toThrow(/not a Trailmark guide/);
    expect(() => parseGuide({ schemaVersion: 'one' })).toThrow(/invalid schema version/);
  });
});

describe('rich text', () => {
  const rt = {
    spans: [
      { text: 'Click ' },
      { text: 'Save <now>', bold: true },
      { text: ' or see ', italic: true },
      { text: 'help', href: 'https://example.com/?a=1&b=2' },
    ],
  };

  it('renders Markdown', () => {
    expect(toMarkdown(rt)).toBe(
      'Click **Save \\<now\\>** *or see* [help](https://example.com/?a=1&b=2)',
    );
  });

  it('renders escaped HTML', () => {
    expect(toHtml(rt)).toBe(
      'Click <strong>Save &lt;now&gt;</strong><em> or see </em>' +
        '<a href="https://example.com/?a=1&amp;b=2" rel="noopener noreferrer">help</a>',
    );
  });
});
