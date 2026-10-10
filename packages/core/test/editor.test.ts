import { describe, expect, it } from 'vitest';
import { History } from '../src/editor/history.js';
import {
  applyBlurToSteps,
  bulkBlurCandidates,
  resetImage,
  withMagnify,
  withOriginal,
} from '../src/editor/image.js';
import {
  deleteBlocks,
  duplicateBlocks,
  insertBlankStep,
  insertCallout,
  insertHeading,
  mergeWithNext,
  moveBlocks,
  nudgeBlock,
  sectionOf,
  splitRichText,
  splitStep,
  stepNumbers,
} from '../src/editor/ops.js';
import { createGuide, createHeading, createStep } from '../src/factory.js';
import { serializeGuide } from '../src/migrations.js';
import { plain, toMarkdown, toPlainText } from '../src/richText.js';
import type { Guide, Step } from '../src/schema.js';

const app = { kind: 'web' as const, url: 'http://localhost:5173/app/' };
const shot = { file: 'img/a.webp', width: 1000, height: 800, dpr: 1 };
const step = (title: string, extra: Partial<Step['human']> = {}) =>
  createStep({ action: 'click', app, human: { title: plain(title), ...extra } });

function guide(): Guide {
  return createGuide({
    blocks: [
      createHeading('Start'),
      step('Click New invoice', { screenshot: shot, actionBox: { x: 10, y: 10, w: 50, h: 20 } }),
      step('Type the supplier', { screenshot: shot }),
      createHeading('Finish'),
      step('Click Submit', { screenshot: { ...shot, width: 1200 } }),
    ],
  });
}
const kinds = (g: Guide) =>
  g.blocks.map((b) =>
    b.kind === 'step' ? toPlainText(b.human.title) : `#${b.kind === 'heading' ? b.text : b.text}`,
  );
const ids = (g: Guide) => g.blocks.map((b) => b.id);

describe('block operations', () => {
  it('moves one or several blocks, keeping their order', () => {
    const g = guide();
    const [h1, s1, s2, h2, s3] = ids(g);
    expect(kinds(moveBlocks(g, [s3!], 0))[0]).toBe('Click Submit');
    expect(kinds(moveBlocks(g, [s2!, s1!], 3))).toEqual([
      '#Start',
      '#Finish',
      'Click Submit',
      'Click New invoice',
      'Type the supplier',
    ]);
    expect(moveBlocks(g, [h1!], 0)).toBe(g); // no change, same object
    expect(kinds(nudgeBlock(g, h2!, -1))).toEqual([
      '#Start',
      'Click New invoice',
      '#Finish',
      'Type the supplier',
      'Click Submit',
    ]);
  });

  it('never mutates the original guide', () => {
    const g = guide();
    const before = serializeGuide(g);
    moveBlocks(g, [ids(g)[4]!], 0);
    deleteBlocks(g, [ids(g)[0]!]);
    duplicateBlocks(g, [ids(g)[1]!]);
    mergeWithNext(g, ids(g)[1]!);
    expect(serializeGuide(g)).toBe(before);
  });

  it('deletes and duplicates several blocks', () => {
    const g = guide();
    const [, s1, s2] = ids(g);
    expect(kinds(deleteBlocks(g, [s1!, s2!]))).toEqual(['#Start', '#Finish', 'Click Submit']);
    const { guide: d, newIds } = duplicateBlocks(g, [s1!, s2!]);
    expect(kinds(d)).toEqual([
      '#Start',
      'Click New invoice',
      'Type the supplier',
      'Click New invoice',
      'Type the supplier',
      '#Finish',
      'Click Submit',
    ]);
    expect(newIds).toHaveLength(2);
    expect(new Set(ids(d)).size).toBe(7);
  });

  it('inserts blank steps, headings and callouts', () => {
    const g = guide();
    const [h1] = ids(g);
    let r = insertBlankStep(g, h1!, 'Check the total');
    expect(kinds(r.guide)[1]).toBe('Check the total');
    const blank = r.guide.blocks[1] as Step;
    expect(blank.action).toBe('manual');
    expect(blank.app).toEqual(app);
    r = insertHeading(r.guide, null, 'Before you start');
    expect(kinds(r.guide)[0]).toBe('#Before you start');
    r = insertCallout(r.guide, r.id, 'warning', 'Check the ABN');
    expect(r.guide.blocks[1]).toMatchObject({
      kind: 'callout',
      tone: 'warning',
      text: 'Check the ABN',
    });
    expect(() => serializeGuide(r.guide)).not.toThrow();
  });

  it('merges a step with the next one', () => {
    const g = guide();
    const merged = mergeWithNext(g, ids(g)[1]!);
    expect(kinds(merged)).toEqual([
      '#Start',
      'Click New invoice, then type the supplier',
      '#Finish',
      'Click Submit',
    ]);
    expect((merged.blocks[1] as Step).human.screenshot).toEqual(shot);
    expect(mergeWithNext(g, ids(g)[2]!)).toBe(g); // next is a heading
  });

  it('splits rich text and steps', () => {
    const [a, b] = splitRichText(
      { spans: [{ text: 'Type ' }, { text: 'INV-1', bold: true }, { text: ' and press Enter' }] },
      10,
    );
    expect(toMarkdown(a)).toBe('Type **INV-1**');
    expect(toMarkdown(b)).toBe('and press Enter');

    const g = guide();
    const s1 = ids(g)[1]!;
    const { guide: out, newId } = splitStep(g, s1, 'Click New'.length);
    expect(kinds(out).slice(1, 3)).toEqual(['Click New', 'invoice']);
    const second = out.blocks[2] as Step;
    expect(second.id).toBe(newId);
    expect(second.human.screenshot).toMatchObject({ file: 'img/a.webp', reusedFromStepId: s1 });
    expect(second.target).toBeUndefined();
    // Default split point is near the middle at a word boundary.
    expect(kinds(splitStep(g, ids(g)[2]!).guide).slice(2, 4)).toEqual(['Type the', 'supplier']);
    expect(splitStep(g, ids(g)[0]!).guide).toBe(g); // headings do not split
  });

  it('numbers steps and finds sections', () => {
    const g = guide();
    expect([...stepNumbers(g).values()]).toEqual([1, 2, 3]);
    expect(sectionOf(g, ids(g)[0]!)).toEqual(ids(g).slice(0, 3));
    expect(sectionOf(g, ids(g)[1]!)).toEqual([]);
  });
});

describe('image edits', () => {
  it('keeps the original on first edit and resets to it', () => {
    const s = step('x', { screenshot: shot, actionBox: { x: 1, y: 2, w: 3, h: 4 } });
    const edited = withOriginal(s);
    edited.human.screenshot = { ...shot, file: 'img/replaced.webp' };
    edited.human.blurs = [{ x: 0, y: 0, w: 5, h: 5 }];
    edited.human.annotations = [
      { id: 'a', kind: 'badge', at: { x: 1, y: 1 }, number: 1, color: '#000' },
    ];
    edited.human.actionBox = { x: 9, y: 9, w: 9, h: 9 };
    expect(withOriginal(edited)).toBe(edited); // original already kept
    const reset = resetImage(edited);
    expect(reset.human).toMatchObject({
      screenshot: shot,
      actionBox: { x: 1, y: 2, w: 3, h: 4 },
      blurs: [],
      annotations: [],
    });
    expect(reset.human.original).toBeUndefined();
  });

  it('magnifies around the Action Box and can turn it off', () => {
    const s = step('x', { screenshot: shot, actionBox: { x: 10, y: 10, w: 50, h: 20 } });
    const on = withMagnify(s, 2);
    expect(on.human.screenshot?.zoom).toBe(2);
    expect(on.human.screenshot?.crop).toEqual({ x: 0, y: 0, w: 500, h: 400 });
    const off = withMagnify(on, 1);
    expect(off.human.screenshot?.crop).toBeUndefined();
  });

  it('applies a blur region to several steps with same-size screenshots', () => {
    const g = guide();
    const [, s1, s2, , s3] = ids(g);
    expect(bulkBlurCandidates(g, s1!).map((s) => s.id)).toEqual([s2]);
    const out = applyBlurToSteps(g, { x: 1, y: 1, w: 10, h: 10 }, [s1!, s2!]);
    expect((out.blocks[1] as Step).human.blurs).toHaveLength(1);
    expect((out.blocks[2] as Step).human.blurs).toHaveLength(1);
    expect((out.blocks[4] as Step).human.blurs).toHaveLength(0);
    expect(s3).toBeDefined();
  });
});

describe('History', () => {
  it('undoes, redoes and drops the redo branch on a new change', () => {
    const h = new History(1);
    h.push(2);
    h.push(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.canUndo).toBe(false);
    expect(h.redo()).toBe(2);
    h.push(4);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe(2);
    h.replace(5);
    expect(h.current).toBe(5);
    h.reset(9);
    expect(h.canUndo || h.canRedo).toBe(false);
  });

  it('caps its length and ignores no-op pushes', () => {
    const h = new History(0, 3);
    for (let i = 1; i <= 10; i++) h.push(i);
    h.push(10);
    let undos = 0;
    while (h.canUndo) {
      h.undo();
      undos++;
    }
    expect(undos).toBe(3);
  });
});
