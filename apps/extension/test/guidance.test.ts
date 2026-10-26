import { IDBFactory } from 'fake-indexeddb';
import {
  IndexedDbStore,
  createGuide,
  createStep,
  liveNeedsConfirm,
  parseAnalytics,
  plain,
  type Step,
  type Target,
} from '@showsteps/core';
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
  /** How the top page answers the sign-in check (undefined: no answer). */
  let signIn: { host: string; secretField: boolean } | undefined;
  /** The name the page's element has now (H4); undefined: the recorded one. */
  let liveName: string | undefined;
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
      if (msg.type === 'guide-run') {
        if (!found) return { result: 'not-found' };
        // As the content script does: the live element's name decides (H4).
        const live = { role: 'button', name: liveName ?? msg.step.target?.name };
        const run = {
          confirmed: msg.confirmed ?? false,
          ...(msg.approvedName !== undefined ? { approvedName: msg.approvedName } : {}),
        };
        if (liveNeedsConfirm(msg.step, live, run))
          return { result: 'cannot', reason: 'needs-confirm', name: live.name };
        return { result: 'acted' };
      }
      if (msg.type === 'guide-check') return { failed: [] };
      if (msg.type === 'guide-signin') return signIn;
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
    found: () => (found = true),
    signInPage: (page: { host: string; secretField: boolean } | undefined) => (signIn = page),
    liveName: (name: string | undefined) => (liveName = name),
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

  it('stops for a sign-in page on another host, and Continue retries the step', async () => {
    const t = await setup([step('Click A'), step('Click B')]);
    await t.g.start({ type: 'guide-start', guideId: t.guide.id, mode: 'run', tabId: 1 });
    await t.settle();
    expect(t.g.current.status).toBe('done');

    const t2 = await setup([step('Click A'), step('Click B')]);
    t2.notFound();
    t2.signInPage({ host: '127.0.0.1', secretField: true });
    await t2.g.start({ type: 'guide-start', guideId: t2.guide.id, mode: 'run', tabId: 1 });
    await t2.settle();
    expect(t2.g.current).toMatchObject({ index: 0, phase: 'failed', reason: 'sign-in' });
    expect(t2.sent.find((x) => x.msg.type === 'guide-notice')).toEqual({
      msg: { type: 'guide-notice', kind: 'sign-in' },
      frameId: 0,
    });
    // The person signs in; Continue tries the step again and the run finishes.
    t2.found();
    await t2.g.control('retry');
    await t2.settle();
    expect(t2.g.current.status).toBe('done');
  });

  it('treats a missing element as not found when the page is on the step’s own host or no sign-in', async () => {
    const own = await setup([step('Click A')]);
    own.notFound();
    own.signInPage({ host: 'localhost', secretField: true });
    await own.g.start({ type: 'guide-start', guideId: own.guide.id, mode: 'run', tabId: 1 });
    await own.settle();
    expect(own.g.current).toMatchObject({ phase: 'failed', reason: 'not-found' });

    const plainPage = await setup([step('Click A')]);
    plainPage.notFound();
    plainPage.signInPage({ host: 'example.com', secretField: false });
    await plainPage.g.start({
      type: 'guide-start',
      guideId: plainPage.guide.id,
      mode: 'run',
      tabId: 1,
    });
    await plainPage.settle();
    expect(plainPage.g.current).toMatchObject({ phase: 'failed', reason: 'not-found' });

    const idp = await setup([step('Click A')]);
    idp.notFound();
    idp.signInPage({ host: 'acme.okta.com', secretField: false });
    await idp.g.start({ type: 'guide-start', guideId: idp.guide.id, mode: 'run', tabId: 1 });
    await idp.settle();
    expect(idp.g.current).toMatchObject({ phase: 'failed', reason: 'sign-in' });
  });

  it('runs pre-approved confirm steps for a schedule, in its own window only', async () => {
    const submit = step('Click Submit', {
      agent: { timeoutMs: 1000, confirm: true, visualOnly: false },
    });
    const other = step('Click Delete', {
      agent: { timeoutMs: 1000, confirm: true, visualOnly: false },
    });
    const t = await setup([step('Click A'), submit, other]);
    await t.g.start(
      { type: 'guide-start', guideId: t.guide.id, mode: 'run', tabId: 1, windowId: 5 },
      { approved: [submit.id], scheduleId: 'sched', windowId: 5 },
    );
    await t.settle();
    // Submit ran without asking; Delete still asks.
    expect(t.ran().map((m) => m.type === 'guide-run' && m.step.id)).toContain(submit.id);
    expect(t.g.current).toMatchObject({ index: 2, phase: 'confirm', scheduleId: 'sched' });
    // The person switching tabs in their own window doesn't pull the run there.
    await t.g.tabActivated(2, 9);
    expect(t.g.current.tabId).toBe(1);
    await t.g.control('stop');
    expect(t.states.at(-1)).toMatchObject({ status: 'idle', scheduleId: 'sched' });
    expect(t.g.current.scheduleId).toBeUndefined();
  });
});

describe('the live element decides (H4)', () => {
  it('stops for confirm when a step recorded as Next now presses Delete account', async () => {
    const t = await setup([step('Click Next', { target: { ...target, name: 'Next' } })]);
    t.liveName('Delete account');
    await t.g.start({ type: 'guide-start', guideId: t.guide.id, mode: 'run', tabId: 1 });
    await t.settle();
    expect(t.g.current).toMatchObject({ index: 0, phase: 'confirm' });
    expect(t.ran()).toHaveLength(1);
    // The person confirms: it goes ahead.
    await t.g.control('confirm');
    await t.settle();
    expect(t.ran().at(-1)).toMatchObject({ confirmed: true });
    expect(t.g.current.status).toBe('done');
  });

  it('holds a schedule’s approval only while the live name is the approved one', async () => {
    const submit = step('Click Submit', {
      target: { ...target, name: 'Submit' },
      agent: { timeoutMs: 1000, confirm: true, visualOnly: false },
    });
    const t = await setup([submit]);
    t.liveName('Pay now');
    await t.g.start(
      { type: 'guide-start', guideId: t.guide.id, mode: 'run', tabId: 1, windowId: 5 },
      { approved: [submit.id], scheduleId: 'sched', windowId: 5 },
    );
    await t.settle();
    expect(t.ran()[0]).toMatchObject({ approvedName: 'Submit', confirmed: false });
    expect(t.g.current).toMatchObject({ index: 0, phase: 'confirm', scheduleId: 'sched' });
    await t.g.control('stop');
  });
});

describe('attach steps (1.2)', () => {
  const download = step('Click Download PDF');
  const upload = (from: string) =>
    step('Upload report.pdf', {
      action: 'upload',
      input: { mode: 'fixed', value: 'report.pdf', sensitive: false, from: { download: from } },
    });

  it('Guide Me says which download to choose', async () => {
    const t = await setup([download, upload(download.id)]);
    await t.g.start({ type: 'guide-start', guideId: t.guide.id, mode: 'guide', tabId: 1 });
    await t.settle();
    await t.g.control('next');
    await t.settle();
    expect(t.shown().at(-1)).toMatchObject({ phase: 'showing', hint: { step: 1 } });
  });

  it('Run for me stops at an attach step with nothing to attach, saying so', async () => {
    const t = await setup([download, upload('latest')]);
    await t.g.start({ type: 'guide-start', guideId: t.guide.id, mode: 'run', tabId: 1 });
    await t.settle();
    // No file store in these deps: the run keeps nothing, so the step is the person's.
    expect(t.g.current).toMatchObject({
      index: 1,
      phase: 'manual',
      reason: 'file-missing',
      file: { name: 'report.pdf' },
    });
    expect(t.shown().at(-1)).toMatchObject({ phase: 'manual', hint: { name: 'report.pdf' } });
  });
});
