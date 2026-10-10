// Immutable guide editing operations shared by every editor. Each returns a new guide (or the
// same one when nothing changed) and never mutates its input.
import { createCallout, createHeading, createStep } from '../factory.js';
import { createId, nowIso } from '../ids.js';
import { normalize, plain, toPlainText } from '../richText.js';
import type { Block, CalloutTone, Guide, RichText, Span, Step } from '../schema.js';

export type BlockId = string;

function withBlocks(guide: Guide, blocks: Block[]): Guide {
  return { ...guide, blocks };
}

export function indexOf(guide: Guide, id: BlockId): number {
  return guide.blocks.findIndex((b) => b.id === id);
}

/** Replace one block by id. */
export function updateBlock<B extends Block>(
  guide: Guide,
  id: BlockId,
  change: (b: B) => B,
): Guide {
  const i = indexOf(guide, id);
  if (i < 0) return guide;
  const blocks = [...guide.blocks];
  blocks[i] = change(blocks[i] as B);
  return withBlocks(guide, blocks);
}

export function updateStep(guide: Guide, id: BlockId, change: (s: Step) => Step): Guide {
  return updateBlock<Block>(guide, id, (b) => (b.kind === 'step' ? change(b) : b));
}

/**
 * Move blocks (in their current relative order) so the first lands at `toIndex`, an index
 * into the guide *without* the moved blocks. Works for drag and drop of one or many.
 */
export function moveBlocks(guide: Guide, ids: readonly BlockId[], toIndex: number): Guide {
  const set = new Set(ids);
  const moving = guide.blocks.filter((b) => set.has(b.id));
  if (!moving.length) return guide;
  const rest = guide.blocks.filter((b) => !set.has(b.id));
  const at = Math.min(Math.max(toIndex, 0), rest.length);
  const blocks = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  return blocks.every((b, i) => b === guide.blocks[i]) ? guide : withBlocks(guide, blocks);
}

/** Move one block up (-1) or down (+1) by one place. */
export function nudgeBlock(guide: Guide, id: BlockId, delta: -1 | 1): Guide {
  const i = indexOf(guide, id);
  if (i < 0) return guide;
  return moveBlocks(guide, [id], i + delta);
}

export function deleteBlocks(guide: Guide, ids: readonly BlockId[]): Guide {
  const set = new Set(ids);
  const blocks = guide.blocks.filter((b) => !set.has(b.id));
  return blocks.length === guide.blocks.length ? guide : withBlocks(guide, blocks);
}

/** Copies of the given blocks (new ids) placed right after the last of them. */
export function duplicateBlocks(
  guide: Guide,
  ids: readonly BlockId[],
): { guide: Guide; newIds: BlockId[] } {
  const set = new Set(ids);
  const picked = guide.blocks.filter((b) => set.has(b.id));
  if (!picked.length) return { guide, newIds: [] };
  const copies = picked.map((b) => ({ ...structuredClone(b), id: createId() }) as Block);
  const last = Math.max(...picked.map((b) => indexOf(guide, b.id)));
  const blocks = [...guide.blocks.slice(0, last + 1), ...copies, ...guide.blocks.slice(last + 1)];
  return { guide: withBlocks(guide, blocks), newIds: copies.map((c) => c.id) };
}

export function insertBlock(guide: Guide, block: Block, at: number): Guide {
  const i = Math.min(Math.max(at, 0), guide.blocks.length);
  return withBlocks(guide, [...guide.blocks.slice(0, i), block, ...guide.blocks.slice(i)]);
}

/** Insert after the block with `afterId` (or at the start when null). Returns the new block's id. */
function insertAfter(
  guide: Guide,
  afterId: BlockId | null,
  block: Block,
): { guide: Guide; id: BlockId } {
  const at = afterId === null ? 0 : indexOf(guide, afterId) + 1 || guide.blocks.length;
  return { guide: insertBlock(guide, block, at), id: block.id };
}

/** A blank, manual step the reader performs themselves (no target, no screenshot). */
export function insertBlankStep(
  guide: Guide,
  afterId: BlockId | null,
  title = '',
): { guide: Guide; id: BlockId } {
  const app = lastApp(guide, afterId);
  return insertAfter(
    guide,
    afterId,
    createStep({
      action: 'manual',
      app,
      human: { title: plain(title) },
      capture: { source: 'manual', at: nowIso() },
    }),
  );
}

export function insertHeading(
  guide: Guide,
  afterId: BlockId | null,
  text: string,
): { guide: Guide; id: BlockId } {
  return insertAfter(guide, afterId, createHeading(text));
}

export function insertCallout(
  guide: Guide,
  afterId: BlockId | null,
  tone: CalloutTone,
  text: string,
): { guide: Guide; id: BlockId } {
  return insertAfter(guide, afterId, createCallout(tone, text));
}

/** Most recent app context at or before a position, for new manual steps. */
function lastApp(guide: Guide, afterId: BlockId | null): Step['app'] {
  const end = afterId === null ? 0 : indexOf(guide, afterId) + 1;
  for (let i = end - 1; i >= 0; i--) {
    const b = guide.blocks[i];
    if (b?.kind === 'step') return b.app;
  }
  const first = guide.blocks.find((b): b is Step => b.kind === 'step');
  return first?.app ?? { kind: 'web', url: 'about:blank' };
}

/**
 * Merge a step with the next step: the titles join ("A, then B"), descriptions join, and the
 * first step keeps its action, target and screenshot. Returns the guide unchanged if the next
 * block is not a step.
 */
export function mergeWithNext(guide: Guide, id: BlockId, joiner = ', then '): Guide {
  const i = indexOf(guide, id);
  const a = guide.blocks[i];
  const b = guide.blocks[i + 1];
  if (a?.kind !== 'step' || b?.kind !== 'step') return guide;
  const lowerFirst = (rt: RichText): RichText => {
    const [first, ...rest] = rt.spans;
    if (!first) return rt;
    return {
      spans: [
        { ...first, text: first.text.charAt(0).toLowerCase() + first.text.slice(1) },
        ...rest,
      ],
    };
  };
  const title = normalize({
    spans: [...a.human.title.spans, { text: joiner }, ...lowerFirst(b.human.title).spans],
  });
  const descriptions = [a.human.description, b.human.description].filter((d): d is RichText => !!d);
  const description =
    descriptions.length === 2
      ? normalize({ spans: [...descriptions[0]!.spans, { text: ' ' }, ...descriptions[1]!.spans] })
      : descriptions[0];
  const merged: Step = {
    ...a,
    human: { ...a.human, title, ...(description ? { description } : {}) },
  };
  const blocks = [...guide.blocks];
  blocks.splice(i, 2, merged);
  return withBlocks(guide, blocks);
}

/** Split rich text at a character offset. */
export function splitRichText(rt: RichText, offset: number): [RichText, RichText] {
  const left: Span[] = [];
  const right: Span[] = [];
  let seen = 0;
  for (const s of rt.spans) {
    const end = seen + s.text.length;
    if (end <= offset) left.push(s);
    else if (seen >= offset) right.push(s);
    else {
      left.push({ ...s, text: s.text.slice(0, offset - seen) });
      right.push({ ...s, text: s.text.slice(offset - seen) });
    }
    seen = end;
  }
  const trim = (spans: Span[], side: 'start' | 'end'): RichText => {
    const out = normalize({ spans });
    const edge = side === 'start' ? out.spans[0] : out.spans[out.spans.length - 1];
    if (edge) edge.text = side === 'start' ? edge.text.trimStart() : edge.text.trimEnd();
    return normalize(out);
  };
  return [trim(left, 'end'), trim(right, 'start')];
}

/**
 * Split a step's title at `offset`: the first part stays, the rest becomes a new step right
 * after it that shares the same screenshot (so each part can be annotated separately).
 * Without an offset the split happens at the middle sentence or word boundary.
 */
export function splitStep(
  guide: Guide,
  id: BlockId,
  offset?: number,
): { guide: Guide; newId?: BlockId } {
  const i = indexOf(guide, id);
  const step = guide.blocks[i];
  if (step?.kind !== 'step') return { guide };
  const text = toPlainText(step.human.title);
  const at = offset ?? defaultSplitPoint(text);
  if (at <= 0 || at >= text.length) return { guide };
  const [head, tail] = splitRichText(step.human.title, at);
  if (!toPlainText(head) || !toPlainText(tail)) return { guide };
  const second: Step = {
    ...structuredClone(step),
    id: createId(),
    action: 'manual',
    human: {
      ...structuredClone(step.human),
      title: tail,
      annotations: [],
      ...(step.human.screenshot
        ? {
            screenshot: {
              ...step.human.screenshot,
              reusedFromStepId: step.human.screenshot.reusedFromStepId ?? step.id,
            },
          }
        : {}),
    },
  };
  delete second.human.description;
  delete second.target;
  delete second.input;
  const first: Step = { ...step, human: { ...step.human, title: head } };
  const blocks = [...guide.blocks];
  blocks.splice(i, 1, first, second);
  return { guide: withBlocks(guide, blocks), newId: second.id };
}

function defaultSplitPoint(text: string): number {
  const mid = text.length / 2;
  const candidates = [...text.matchAll(/[.!?;,]\s+|\s+(?:and|then)\s+|\s+/g)].map(
    (m) => (m.index ?? 0) + m[0].length,
  );
  if (!candidates.length) return -1;
  return candidates.reduce((best, c) => (Math.abs(c - mid) < Math.abs(best - mid) ? c : best));
}

/** Step numbers as readers see them (headings and callouts are not numbered). */
export function stepNumbers(guide: Guide): Map<BlockId, number> {
  const out = new Map<BlockId, number>();
  let n = 0;
  for (const b of guide.blocks) if (b.kind === 'step') out.set(b.id, ++n);
  return out;
}

/** The blocks that belong to a heading's section: the heading up to the next heading. */
export function sectionOf(guide: Guide, headingId: BlockId): BlockId[] {
  const i = indexOf(guide, headingId);
  if (guide.blocks[i]?.kind !== 'heading') return [];
  const ids = [headingId];
  for (let j = i + 1; j < guide.blocks.length && guide.blocks[j]!.kind !== 'heading'; j++)
    ids.push(guide.blocks[j]!.id);
  return ids;
}
