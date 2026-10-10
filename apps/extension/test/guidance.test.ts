import { IDBFactory } from 'fake-indexeddb';
import {
  IndexedDbStore,
  createGuide,
  createStep,
  parseAnalytics,
  plain,
  type Step,
  type Target,
} from '@trailmark/core';
import { describe, expect, it } from 'vitest';
import { Guidance, frameFor, type GuidanceDeps } from '../lib/guidance';
import type { GuideToContent, GuidanceState } from '../lib/guideMessages';

const PAGE = 'http://localhost:5173/app/';
const target: Target = {
  role: 'button',
  name: 'Save',
  selectors: [],
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  point: { x: 5, y: 5 },
};
const web = (frameUrl?: string) => ({
  kind: 'web' as const,
  url: PAGE,
  ...(frameUrl ? { frameUrl } : {}),
});

function step(title: string, over: Partial<Step> = {}): Step {
  return {
    ...createStep({ action: 'click', app: web(), target, human: { title: plain(title) } }),
    ...over,
  };
}

async function setup(blocks: Step[], tabUrl = PAGE) {
  const store = new IndexedDbStore(new IDBFactory(), { user: 'Alex' });
  const guide = createGuide({ title: 'Pay', blocks });
  await store.saveGuide(guide);
  const sent: { msg: GuideToContent; frameId?: number }[] = [];
  const states: GuidanceState[] = [];
  /** How the page answers guide-show / guide-run. */
  let found = true;
  const deps: GuidanceDeps = {
    store,
    userName: async () => 'Alex',
    tabUrl: async () => tabUrl,
    openTab: async () => 99,
    navigate: async () => undefined,
    waitLoaded: async () => undefined,
    frames: async () => [
      { frameId: 0, url: PAGE },
      { frameId: 4, url: 'http://127.0.0.1:5174/widget.html' },
    ],
    async send(_tab, msg, frameId) {
      sent.push({ msg, ...(frameId !== undefined ? { frameId } : {}) });
      if (msg.type === 'guide-show') return { found };
      if (msg.type === 'guide-run') return { result: found ? 'acted' : 'not-found' };
      if (msg.type === 'guide-check') return { failed: [] };
      return { ok: true };
    },
    broadcast: (s) => states.push(s),
    persist: async () => undefined,
    sleep: async () => undefined,
    now: () => '2026-10-10T00:00:00.000Z',
  };
  const g = new Guidance(deps);
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return {
    g,
    guide,
    store,
    sent,
    states,
    settle,
    notFound: () => (found = false),
    shown: () => sent.filter((x) => x.msg.type === 'guide-show').map((x) => x.msg),
    ran: () => sent.filter((x) => x.msg.type === 'guide-run').map((x) => x.msg),
  };
}

describe('frame routing', () => {
  it('sends a step to the iframe it was recorded in, else the top frame', () => {
    const frames = [
      { frameId: 0, url: PAGE },
      { frameId: 4, url: 'http://127.0.0.1:5174/widget.html?x=1' },
    ];
    expect(frameFor(frames, step('a'))).toBe(0);
    expect(frameFor(frames, step('b', { app: web('http://127.0.0.1:5174/widget.html') }))).toBe(4);
    expect(
      frameFor(frames.slice(0, 1), step('c', { app: web('http://127.0.0.1:5174/widget.html') })),
    ).toBeUndefined();
  });
});

describe('Guide Me', () => {
  it('highlights each step and moves on when the person does it, then records a completed run', async () => {
    const s1 = step('Click Save');
    const s2 = step('Click Send');
    const t = await setup([s1, s2]);
    await t.g.start({ type: 'guide-start', guideId: t.guide.id, mode: 'guide', tabId: 1 });
    await t.settle();
    expect(t.g.current).toMatchObject({ status: 'active', index: 0, phase: 'showing' });
    await t.g.stepDone(1, s2.id); // not the current step: ignored
    expect(t.g.current.index).toBe(0);
    await t.g.stepDone(1, s1.id);
    await t.settle();
    expect(t.g.current).toMatchObject({ index: 1, phase: 'showing' });
    await t.g.control('next');
    await t.settle();
    expect(t.g.current.status).toBe('done');
    const analytics = parseAnalytics(await t.store.readSidecar(t.guide.id, 'analytics', 'Alex'));
    expect(analytics.runs).toEqual([
      expect.objectContaining({ mode: 'guide', completed: true, reached: 2, total: 2 }),
    ]);
  });

  it('reports a missing target and skips a navigate step whose page is already open', async () => {
    const nav = step('Go to app', { action: 'navigate' });
    const t = await setup([nav, step('Click Save')]);
    t.notFound();
    await t.g.start({ type: 'guide-start', guideId: t.guide.id, mode: 'guide', tabId: 1 });
    await t.settle();
    expect(t.g.current).toMatchObject({ index: 1, phase: 'not-found' });
  });

  it('opens the first page in a new tab when the current tab is elsewhere', async () => {
    const t = await setup([step('Click Save')], 'https://example.com/');
    await t.g.start({ type: 'guide-start', guideId: t.guide.id, mode: 'guide', tabId: 1 });
    expect(t.g.current.tabId).toBe(99);
  });
});

describe('Run for me', () => {
  it('acts, waits for secrets and asks before confirm steps', async () => {
    const s1 = step('Click Edit');
    const secret = step('Enter your password', {
      action: 'type',
      input: { mode: 'fixed', sensitive: true },
    });
    const submit = step('Click Submit', {
      agent: { timeoutMs: 1000, confirm: true, visualOnly: false },
    });
    const t = await setup([s1, secret, submit]);
    await t.g.start({
      type: 'guide-start',
      guideId: t.guide.id,
      mode: 'run',
      tabId: 1,
      speed: 'fast',
    });
    await t.settle();
    expect(t.ran().map((m) => m.type === 'guide-run' && m.step.id)).toEqual([s1.id]);
    expect(t.g.current).toMatchObject({ index: 1, phase: 'manual', reason: 'secret' });

    await t.g.stepDone(1, secret.id);
    await t.settle();
    expect(t.g.current).toMatchObject({ index: 2, phase: 'confirm' });
    expect(t.ran()).toHaveLength(1); // nothing done without approval
    const card = t.shown().at(-1);
    expect(card).toMatchObject({ type: 'guide-show', phase: 'confirm' });

    await t.g.control('confirm');
    await t.settle();
    expect(t.ran()).toHaveLength(2);
    expect(t.g.current.status).toBe('done');
  });

  it('stops when a target is missing, and can pause after every step', async () => {
    const t = await setup([step('Click A'), step('Click B')]);
    await t.g.start({
      type: 'guide-start',
      guideId: t.guide.id,
      mode: 'run',
      tabId: 1,
      stepThrough: true,
    });
    await t.settle();
    expect(t.g.current).toMatchObject({ index: 1, phase: 'paused' });
    t.notFound();
    await t.g.control('step');
    await t.settle();
    expect(t.g.current).toMatchObject({ index: 1, phase: 'failed', reason: 'not-found' });
    await t.g.control('stop');
    expect(t.g.current.status).toBe('idle');
  });
});
