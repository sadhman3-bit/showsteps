import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applySecureBlur,
  createGuide,
  createStep,
  detectSensitive,
  findSensitiveOnPage,
  luhn,
  maskValue,
  parsePageText,
  serializePageText,
  validAbn,
  validIban,
  validTfn,
  wordsFileFor,
  type Guide,
  type PageText,
  type TextRun,
} from '../src/index.js';

const planted = JSON.parse(
  readFileSync(new URL('../../../fixtures/demo-app/planted-secrets.json', import.meta.url), 'utf8'),
) as { values: { kind: string; text: string }[] };

/** A run whose words sit 10 px apart per character on one line. */
function run(text: string, y = 0): TextRun {
  const words: TextRun['words'] = [];
  for (const m of text.matchAll(/\S+/g))
    words.push([m.index, m.index + m[0].length, m.index * 10, y, m[0].length * 10, 16]);
  return { text, words };
}

describe('Secure Blur detection (E11)', () => {
  it('checks card, TFN, ABN and IBAN numbers', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
    expect(validTfn('123456782')).toBe(true);
    expect(validTfn('123456789')).toBe(false);
    expect(validAbn('51824753556')).toBe(true);
    expect(validAbn('51824753557')).toBe(false);
    expect(validIban('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(validIban('GB82 WEST 1234 5698 7654 33')).toBe(false);
  });

  it('finds every planted value on the demo dashboard, labels as context', () => {
    // The dashboard's "Supplier contact" table: a label cell, then the value cell.
    const labels: Record<string, string> = {
      email: 'Email',
      phone: 'Phone',
      card: 'Card on file',
      bsb: 'BSB / Account',
      account: 'BSB / Account',
      tfn: 'TFN',
      abn: 'ABN',
      iban: 'IBAN',
    };
    const runs: TextRun[] = [];
    for (const v of planted.values) {
      if (v.kind === 'account') continue; // shares a cell with the BSB
      const text = v.kind === 'bsb' ? '123-456 / 98765432' : v.text;
      runs.push(run(labels[v.kind]!, runs.length * 20), run(text, runs.length * 20));
    }
    const page: PageText = { width: 1280, height: 800, runs };
    const found = findSensitiveOnPage(page);
    for (const v of planted.values)
      expect(found.map((f) => [f.kind, f.text])).toContainEqual([v.kind, v.text]);
    expect(found).toHaveLength(planted.values.length);
    const card = found.find((f) => f.kind === 'card')!;
    // Padded box around the four words of the card number.
    expect(card.rect).toEqual({ x: 0, y: 77, w: 193, h: 22 });
  });

  it('needs a label for bare account numbers and finds names and amounts on request', () => {
    expect(detectSensitive('Invoice 98765432 approved')).toEqual([]);
    expect(detectSensitive('98765432', {}, 'Account number')).toMatchObject([{ kind: 'account' }]);
    expect(detectSensitive('Call 1300 123 456 or +61 2 9876 5432')).toMatchObject([
      { kind: 'phone', text: '1300 123 456' },
      { kind: 'phone', text: '+61 2 9876 5432' },
    ]);
    const text = 'Paid $1,240.50 to Priya Shah';
    expect(detectSensitive(text)).toEqual([]);
    expect(detectSensitive(text, { amounts: true, names: ['priya shah'] })).toMatchObject([
      { kind: 'amount', text: '$1,240.50' },
      { kind: 'name', text: 'Priya Shah' },
    ]);
    // A long number that fails Luhn is not a card.
    expect(detectSensitive('Order 4111 1111 1111 1112')).toEqual([]);
  });

  it('masks values for the review screen and stores word files next to pictures', () => {
    expect(maskValue('4111 1111 1111 1111')).toBe('••••••••1111');
    expect(maskValue('123-456')).toBe('•••-456');
    expect(wordsFileFor('img/abc.webp')).toBe('abc.words.json');
    const page: PageText = { width: 10, height: 10, runs: [run('hi')] };
    expect(parsePageText(serializePageText(page))).toEqual(page);
    expect(parsePageText(new TextEncoder().encode('{"nope":1}'))).toBeUndefined();
  });

  it('adds approved regions as blurs once', () => {
    const step = createStep({ action: 'click', app: { kind: 'web', url: 'https://x.test/' } });
    const guide: Guide = { ...createGuide({ title: 'T' }), blocks: [step] };
    const rect = { x: 10, y: 10, w: 50, h: 20 };
    const once = applySecureBlur(guide, new Map([[step.id, [rect]]]));
    const twice = applySecureBlur(once, new Map([[step.id, [rect]]]));
    const blurs = (g: Guide) => (g.blocks[0]!.kind === 'step' ? g.blocks[0]!.human.blurs : []);
    expect(blurs(once)).toEqual([rect]);
    expect(blurs(twice)).toEqual([rect]);
  });
});
