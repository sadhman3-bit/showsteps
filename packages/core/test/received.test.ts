import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  IndexedDbStore,
  importGuideArchive,
  liveNeedsConfirm,
  parseGuide,
  receivedSummary,
  serializeGuide,
  trustGuide,
  type Guide,
  type Step,
} from '../src/index.js';

const SAMPLE = new URL(
  '../../../apps/extension/public/samples/create-invoice.showsteps',
  import.meta.url,
);
const sampleZip = () => unzipSync(readFileSync(SAMPLE));
const sample = (): Guide => parseGuide(JSON.parse(strFromU8(sampleZip()['guide.json']!)));
const steps = (g: Guide) => g.blocks.filter((b): b is Step => b.kind === 'step');
const titled = (g: Guide, title: string) =>
  steps(g).find((s) => s.human.title.spans.map((x) => x.text).join('') === title)!;

/** The sample as a file whose author turned every confirm off. */
function withoutConfirms(): Uint8Array {
  const g = sample();
  const off = {
    ...g,
    blocks: g.blocks.map((b) =>
      b.kind === 'step' ? { ...b, agent: { ...b.agent, confirm: false } } : b,
    ),
  };
  return zipSync({ 'guide.json': strToU8(serializeGuide(off)) });
}

describe('guides from someone else (H4)', () => {
  it('import re-arms confirms and marks the guide as received', async () => {
    const store = new IndexedDbStore(new IDBFactory());
    const { guideId } = await importGuideArchive(store, withoutConfirms(), {
      received: { from: 'import', file: 'invoice.showsteps' },
    });
    const g = (await store.getGuide(guideId))!;
    expect(titled(g, 'Click Submit invoice').agent.confirm).toBe(true);
    expect(titled(g, 'Click New invoice').agent.confirm).toBe(false);
    expect(g.received).toMatchObject({ from: 'import', file: 'invoice.showsteps' });
    // It survives saving and reading back.
    expect(parseGuide(JSON.parse(serializeGuide(g))).received).toEqual(g.received);
    // Import marks it by default; ShowSteps's own samples aren't.
    const plain = await importGuideArchive(store, withoutConfirms());
    expect((await store.getGuide(plain.guideId))!.received?.from).toBe('import');
    const own = await importGuideArchive(store, withoutConfirms(), { received: false });
    expect((await store.getGuide(own.guideId))!.received).toBeUndefined();
  });

  it('a 1.1 guide without the mark still parses; trusting removes the mark', () => {
    const g = sample();
    expect(g.received).toBeUndefined();
    const marked = { ...g, received: { at: g.updatedAt, from: 'import' as const } };
    expect(trustGuide(marked).received).toBeUndefined();
  });

  it('summarises the sites, typed values, attach steps and stops', () => {
    const s = receivedSummary(sample());
    expect(s.sites).toEqual(['localhost:5173']);
    expect(s.typed).toContainEqual({ step: 7, field: 'Invoice no.', value: 'INV-1043' });
    expect(s.typed.map((t) => t.value)).not.toContain('not-a-real-password');
    expect(s.stops).toContainEqual({ step: 17, title: 'Click Submit invoice', why: 'confirm' });
    expect(s.stops).toContainEqual(expect.objectContaining({ step: 3, why: 'person' }));
  });

  it('checks the live element’s name before acting', () => {
    const next = titled(sample(), 'Click Review invoice');
    const run = { confirmed: false };
    expect(liveNeedsConfirm(next, { role: 'button', name: 'Review invoice' }, run)).toBe(false);
    // Recorded as harmless, but the page now shows a button that can't be undone.
    expect(liveNeedsConfirm(next, { role: 'button', name: 'Delete account' }, run)).toBe(true);
    expect(
      liveNeedsConfirm(next, { role: 'button', name: 'Delete account' }, { confirmed: true }),
    ).toBe(false);
    // The recorded Submit, unchanged: the guide's own confirm setting decides, not this check.
    const sent = titled(sample(), 'Click Submit invoice');
    expect(liveNeedsConfirm(sent, { role: 'button', name: 'Submit invoice' }, run)).toBe(false);
    // Typing into a field named "Confirm email" isn't a button press.
    const type = titled(sample(), 'Type INV-1043 into Invoice no.');
    expect(liveNeedsConfirm(type, { role: 'textbox', name: 'Confirm email' }, run)).toBe(false);
    // A schedule's approval holds only while the name is the one approved.
    const submit = titled(sample(), 'Click Submit invoice');
    const approved = { confirmed: false, approvedName: 'Submit invoice' };
    expect(liveNeedsConfirm(submit, { role: 'button', name: 'Submit invoice' }, approved)).toBe(
      false,
    );
    expect(liveNeedsConfirm(submit, { role: 'button', name: 'Pay now' }, approved)).toBe(true);
  });
});
