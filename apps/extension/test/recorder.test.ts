import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbStore, toMarkdown, type Step, type Target } from '@trailmark/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { FrameRegistry } from '../lib/frames';
import type { CaptureState, ContentEvent } from '../lib/messages';
import { Recorder, type PersistedRecorder } from '../lib/recorder';
import { ShotLimiter } from '../lib/shots';

const TAB = 7;
const URL_ = 'http://localhost:5173/app/invoices/new';
const target = (name: string, role = 'textbox', x = 100): Target => ({
  role,
  name,
  selectors: [{ type: 'aria', value: `${role} "${name}"`, score: 0.9 }],
  bbox: { x, y: 200, w: 120, h: 30 },
  point: { x: x + 60, y: 215 },
});

function setup() {
  let clock = 0;
  const store = new IndexedDbStore(new IDBFactory(), { user: 'Alex' });
  const frames = new FrameRegistry({
    parentFrameId: async (_tab, frameId) => (frameId === 5 ? 0 : -1),
    iframeGeometry: async () => ({
      rect: { x: 40, y: 600, w: 500, h: 120 },
      selector: 'iframe[title="Cost centre lookup"]',
    }),
  });
  const sent: CaptureState[] = [];
  const persisted: (PersistedRecorder | null)[] = [];
  let captures = 0;
  const recorder = new Recorder({
    store,
    frames,
    limiter: new ShotLimiter(500, () => clock),
    captureVisibleTab: async () => {
      captures++;
      return 'data:image/png;base64,AAAA';
    },
    encode: async () => ({
      full: new Uint8Array([1]),
      thumb: new Uint8Array([2]),
      ext: 'webp',
      width: 2560,
      height: 1600,
    }),
    sendState: (_tab, s) => sent.push(s),
    broadcastState: () => undefined,
    libraryChanged: () => undefined,
    persist: async (d) => void persisted.push(d),
    user: 'Alex',
  });
  const tick = (ms = 600) => (clock += ms);
  const sender = { tabId: TAB, frameId: 0, tabUrl: URL_, tabTitle: 'Ledgerline' };
  const send = async (ev: ContentEvent, opts: { shot?: boolean; frameId?: number } = {}) => {
    tick();
    const shotId = `shot-${clock}-abcdef`;
    if (opts.shot !== false) await recorder.shot(TAB, shotId);
    await recorder.event(
      { ...sender, frameId: opts.frameId ?? 0, frameUrl: 'http://127.0.0.1:5174/widget.html' },
      ev,
      shotId,
    );
  };
  return { recorder, store, frames, sent, persisted, send, tick, captures: () => captures };
}

async function startNew(r: Recorder) {
  return r.start({
    tabId: TAB,
    url: 'http://localhost:5173/login.html',
    title: 'Sign in · Ledgerline',
    viewport: { width: 1280, height: 800, dpr: 2 },
  });
}

const titles = (steps: Step[]) => steps.map((s) => toMarkdown(s.human.title));
const stepsOf = async (store: IndexedDbStore, id: string) =>
  ((await store.getGuide(id))?.blocks ?? []).filter((b): b is Step => b.kind === 'step');

describe('Recorder', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('starts a new guide with a "Go to" step and a screenshot', async () => {
    const state = await startNew(ctx.recorder);
    expect(state).toMatchObject({
      status: 'recording',
      stepCount: 1,
      title: 'Sign in · Ledgerline',
    });
    const steps = await stepsOf(ctx.store, state.guideId!);
    expect(titles(steps)).toEqual(['Go to **localhost:5173**']);
    expect(steps[0]!.human.screenshot).toMatchObject({
      file: `img/${steps[0]!.id}.webp`,
      width: 2560,
      dpr: 2,
    });
    expect(await ctx.store.listImages(state.guideId!)).toEqual([
      `${steps[0]!.id}.thumb.webp`,
      `${steps[0]!.id}.webp`,
    ]);
  });

  it('records events as steps with screenshots, Action Boxes and app context', async () => {
    const { guideId } = await startNew(ctx.recorder);
    await ctx.send({ kind: 'click', button: 'left', target: target('Supplier'), element: 'f:1' });
    await ctx.send({
      kind: 'type',
      target: target('Supplier'),
      element: 'f:1',
      value: 'Harbour Paper Co.',
      sensitive: false,
    });
    const steps = await stepsOf(ctx.store, guideId!);
    expect(titles(steps)).toEqual([
      'Go to **localhost:5173**',
      'Type **Harbour Paper Co.** into **Supplier**',
    ]);
    const s = steps[1]!;
    // scale = 2560 image px / 1280 css px = 2
    expect(s.human.actionBox).toEqual({ x: 192, y: 392, w: 256, h: 76 });
    expect(s.app).toEqual({ kind: 'web', url: URL_, title: 'Ledgerline' });
    expect((await ctx.store.getGuide(guideId!))?.apps).toEqual([
      { kind: 'web', origin: 'http://localhost:5173' },
    ]);
  });

  it('reuses the previous screenshot when the rate limit skips a capture', async () => {
    const { guideId } = await startNew(ctx.recorder);
    await ctx.send({ kind: 'key', key: 'Escape' });
    const before = ctx.captures();
    // Second event in the same instant: no tick, so the limiter refuses.
    await ctx.recorder.shot(TAB, 'shot-same-instant');
    await ctx.recorder.event(
      { tabId: TAB, frameId: 0, tabUrl: URL_ },
      { kind: 'key', key: 'Enter' },
      'shot-same-instant',
    );
    expect(ctx.captures()).toBe(before);
    const steps = await stepsOf(ctx.store, guideId!);
    expect(steps[2]!.human.screenshot).toMatchObject({
      file: steps[1]!.human.screenshot!.file,
      reusedFromStepId: steps[1]!.id,
    });
  });

  it('never stores sensitive values', async () => {
    const { guideId } = await startNew(ctx.recorder);
    await ctx.send({ kind: 'type', target: target('Password'), element: 'p', sensitive: true });
    const guide = await ctx.store.getGuide(guideId!);
    expect(JSON.stringify(guide)).not.toMatch(/hunter|secret/);
    expect(titles(await stepsOf(ctx.store, guideId!))).toContain('Enter your password');
  });

  it('maps iframe events into the top viewport and records the frame chain', async () => {
    const { guideId } = await startNew(ctx.recorder);
    ctx.frames.register(TAB, 5, '00000000-0000-4000-8000-000000000005');
    await ctx.send(
      {
        kind: 'select',
        target: target('Cost centre lookup', 'combobox', 10),
        element: 'w:1',
        value: 'CC-220 Operations',
      },
      { frameId: 5 },
    );
    const step = (await stepsOf(ctx.store, guideId!))[1]!;
    expect(step.target?.bbox).toEqual({ x: 50, y: 800, w: 120, h: 30 });
    expect(step.target?.frames).toEqual(['iframe[title="Cost centre lookup"]']);
    expect(step.app).toMatchObject({ frameUrl: 'http://127.0.0.1:5174/widget.html' });
  });

  it('ignores events while paused, and deletes the last step with its images', async () => {
    const { guideId } = await startNew(ctx.recorder);
    await ctx.send({ kind: 'key', key: 'Enter' });
    await ctx.recorder.control('pause');
    await ctx.send({ kind: 'key', key: 'Escape' });
    expect((await stepsOf(ctx.store, guideId!)).length).toBe(2);
    await ctx.recorder.control('resume');
    const s = await ctx.recorder.control('delete-last');
    expect(s.stepCount).toBe(1);
    const steps = await stepsOf(ctx.store, guideId!);
    expect(steps).toHaveLength(1);
    expect((await ctx.store.listImages(guideId!)).every((n) => n.startsWith(steps[0]!.id))).toBe(
      true,
    );
  });

  it('finishes with a saved version and returns to idle', async () => {
    const { guideId } = await startNew(ctx.recorder);
    await ctx.send({ kind: 'key', key: 'Enter' });
    const s = await ctx.recorder.control('finish');
    expect(s).toMatchObject({ status: 'idle', lastFinishedGuideId: guideId });
    expect(await ctx.store.listVersions(guideId!)).toHaveLength(1);
    expect(ctx.persisted.at(-1)).toBeNull();
    expect(ctx.sent.at(-1)?.status).toBe('idle');
  });

  it('cancelling a new capture deletes the guide', async () => {
    const { guideId } = await startNew(ctx.recorder);
    await ctx.recorder.control('cancel');
    expect(await ctx.store.getGuide(guideId!)).toBeUndefined();
    expect(await ctx.store.listImages(guideId!)).toEqual([]);
  });

  it('captures more steps into an existing guide at a position, and cancel restores it', async () => {
    const { guideId } = await startNew(ctx.recorder);
    await ctx.send({ kind: 'key', key: 'Enter' });
    await ctx.recorder.control('finish');

    ctx.tick();
    await ctx.recorder.start({ tabId: TAB, url: URL_, guideId, insertAt: 1 });
    await ctx.send({ kind: 'key', key: 'Escape' });
    expect(titles(await stepsOf(ctx.store, guideId!))).toEqual([
      'Go to **localhost:5173**',
      'Press **Escape**',
      'Press **Enter**',
    ]);
    await ctx.recorder.control('cancel');
    expect(titles(await stepsOf(ctx.store, guideId!))).toEqual([
      'Go to **localhost:5173**',
      'Press **Enter**',
    ]);
  });

  it('resumes after a service-worker restart', async () => {
    const { guideId } = await startNew(ctx.recorder);
    await ctx.send({ kind: 'key', key: 'Enter' });
    const saved = ctx.persisted.at(-1)!;
    expect(saved.addedStepIds).toHaveLength(2);

    const again = setup();
    // Same database, new recorder instance.
    const r2 = new Recorder({
      ...(again.recorder as unknown as { deps: object }).deps,
      store: ctx.store,
    } as never);
    await r2.restore(saved);
    expect(r2.current).toMatchObject({ status: 'recording', stepCount: 2, guideId });
    await r2.control('finish');
    expect(await stepsOf(ctx.store, guideId!)).toHaveLength(2);
  });
});
