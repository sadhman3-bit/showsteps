import {
  createId,
  guideSteps,
  parseAnalytics,
  planStep,
  recordRun,
  samePage,
  valueFor,
  type GuideStore,
  type Run,
  type Step,
} from '@trailmark/core';
import type { z } from 'zod';
import {
  CheckReplySchema,
  GUIDANCE_IDLE,
  RunReplySchema,
  ShowReplySchema,
  type GuideControl,
  type GuidePageMessage,
  type GuideToContent,
  type GuidanceState,
  type Speed,
} from './guideMessages';

export interface FrameInfo {
  frameId: number;
  url: string;
}

export interface GuidanceDeps {
  store: GuideStore;
  userName(): Promise<string>;
  tabUrl(tabId: number): Promise<string | undefined>;
  openTab(url: string, windowId?: number): Promise<number>;
  navigate(tabId: number, url: string): Promise<void>;
  /** Resolves when the tab has finished loading (or after `timeoutMs`). */
  waitLoaded(tabId: number, timeoutMs: number): Promise<void>;
  frames(tabId: number): Promise<FrameInfo[]>;
  /** Send to one frame (rejects if nothing listens there) or, without frameId, to all frames. */
  send(tabId: number, msg: GuideToContent, frameId?: number): Promise<unknown>;
  broadcast(state: GuidanceState): void;
  persist(data: PersistedGuidance | undefined): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): string;
  /** The desktop app, when connected: it highlights desktop steps on screen (G8). */
  desktop?: {
    available(): boolean;
    show(step: Step, number: number, total: number): void;
    clear(): void;
  };
}

export interface PersistedGuidance {
  state: GuidanceState;
  values: Record<string, string>;
  run: Run;
}

/** Pause between Run for me steps, and how long the cursor takes to travel. */
export const SPEED_DELAY: Record<Speed, number> = { slow: 1400, normal: 700, fast: 250 };
const PAGE_LOAD_TIMEOUT = 15_000;
const RETRY_MS = 250;

/** Which frame shows a step: the iframe it was recorded in, else the top frame. */
export function frameFor(frames: FrameInfo[], step: Step): number | undefined {
  if (step.app.kind !== 'web') return undefined;
  const { frameUrl, url } = step.app;
  if (frameUrl && !samePage(frameUrl, url)) {
    return frames.find((f) => f.frameId !== 0 && samePage(f.url, frameUrl))?.frameId;
  }
  return frames.some((f) => f.frameId === 0) ? 0 : undefined;
}

/**
 * Guide Me and Run for me. Guide Me highlights each step's target and moves on when the person
 * does it; Run for me performs steps itself and stops for confirm steps, manual steps, secrets
 * and failed expectations. One session at a time, following the active tab.
 */
export class Guidance {
  private state: GuidanceState = { ...GUIDANCE_IDLE };
  private steps: Step[] = [];
  private values: Record<string, string> = {};
  private run: Run | undefined;
  private confirmed = new Set<number>();
  /** Bumped whenever the current step changes; stale async work checks it and stops. */
  private seq = 0;
  private reshowTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: GuidanceDeps) {}

  get current(): GuidanceState {
    return this.state;
  }

  get isActive(): boolean {
    return this.state.status === 'active';
  }

  private get step(): Step | undefined {
    return this.steps[this.state.index];
  }

  private set(patch: Partial<GuidanceState>): void {
    this.state = { ...this.state, ...patch };
    if (!patch.reason && 'phase' in patch) delete this.state.reason;
    this.deps.broadcast(this.state);
    void this.save();
  }

  private async save(): Promise<void> {
    await this.deps.persist(
      this.state.status === 'active' && this.run
        ? { state: this.state, values: this.values, run: this.run }
        : undefined,
    );
  }

  // ---------- Analytics (the person's own sidecar) ----------

  private async recordRun(): Promise<void> {
    const run = this.run;
    const guideId = this.state.guideId;
    if (!run || !guideId) return;
    try {
      const user = await this.deps.userName();
      const current = parseAnalytics(await this.deps.store.readSidecar(guideId, 'analytics', user));
      await this.deps.store.writeSidecar(guideId, 'analytics', user, recordRun(current, run));
    } catch {
      // analytics must never break guidance
    }
  }

  private reach(index: number): void {
    if (!this.run || index <= this.run.reached) return;
    this.run = { ...this.run, reached: Math.min(index, this.run.total) };
    void this.recordRun();
  }

  // ---------- Starting and stopping ----------

  async start(msg: Extract<GuidePageMessage, { type: 'guide-start' }>): Promise<GuidanceState> {
    if (this.isActive) await this.finish(false);
    const guide = await this.deps.store.getGuide(msg.guideId);
    if (!guide) throw new Error('not-found');
    const steps = guideSteps(guide);
    const first = steps.find((s) => s.app.kind === 'web');
    if (!first || first.app.kind !== 'web') throw new Error('no-web-steps');
    const startUrl = first.app.url;

    let tabId = msg.tabId;
    const currentUrl = tabId === undefined ? undefined : await this.deps.tabUrl(tabId);
    if (tabId === undefined || !currentUrl || !/^(https?|file):/.test(currentUrl)) {
      tabId = await this.deps.openTab(startUrl, msg.windowId);
    } else if (!samePage(currentUrl, startUrl) && (msg.from ?? 0) === 0) {
      // The first step's page is somewhere else: open it next to the current tab.
      tabId = await this.deps.openTab(startUrl, msg.windowId);
    }

    this.steps = steps;
    this.values = msg.values ?? {};
    this.confirmed = new Set();
    this.run = {
      id: createId(),
      mode: msg.mode,
      startedAt: this.deps.now(),
      reached: 0,
      total: steps.length,
      completed: false,
    };
    this.state = {
      status: 'active',
      mode: msg.mode,
      guideId: guide.id,
      title: guide.title,
      tabId,
      index: Math.min(msg.from ?? 0, steps.length),
      total: steps.length,
      phase: 'finding',
      speed: msg.speed ?? 'normal',
      stepThrough: msg.stepThrough ?? false,
    };
    void this.recordRun();
    void this.show();
    return this.state;
  }

  async finish(completed: boolean): Promise<void> {
    this.seq++;
    clearTimeout(this.reshowTimer);
    const tabId = this.state.tabId;
    if (tabId !== undefined)
      void this.deps.send(tabId, { type: 'guide-clear' }).catch(() => undefined);
    if (this.run) {
      this.run = {
        ...this.run,
        endedAt: this.deps.now(),
        completed,
        ...(completed ? { reached: this.run.total } : {}),
      };
      await this.recordRun();
    }
    this.run = undefined;
    this.set(completed ? { status: 'done', phase: 'finding' } : { ...GUIDANCE_IDLE });
  }

  /** After a worker restart: carry on where the session was (Run for me waits, paused). */
  async restore(data: PersistedGuidance): Promise<void> {
    const guide = data.state.guideId
      ? await this.deps.store.getGuide(data.state.guideId)
      : undefined;
    if (!guide) return;
    this.steps = guideSteps(guide);
    this.values = data.values;
    this.run = data.run;
    this.state = data.state;
    if (this.state.mode === 'run') this.set({ phase: 'paused' });
    else void this.show();
  }

  // ---------- Steps ----------

  private async clear(): Promise<void> {
    this.deps.desktop?.clear();
    const tabId = this.state.tabId;
    if (tabId !== undefined)
      await this.deps.send(tabId, { type: 'guide-clear' }).catch(() => undefined);
  }

  /** A step inside an iframe: the top frame scrolls that iframe into view first. */
  private async revealFrame(step: Step): Promise<void> {
    const tabId = this.state.tabId;
    if (tabId === undefined || step.app.kind !== 'web' || !step.app.frameUrl) return;
    if (samePage(step.app.frameUrl, step.app.url)) return;
    await this.deps
      .send(
        tabId,
        { type: 'guide-frame', frames: step.target?.frames ?? [], frameUrl: step.app.frameUrl },
        0,
      )
      .catch(() => undefined);
  }

  /** Send to the step's frame, retrying while pages load, until a valid reply or timeout. */
  private async deliver<T>(
    seq: number,
    step: Step,
    msg: GuideToContent,
    schema: z.ZodType<T>,
    timeoutMs: number,
  ): Promise<T | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (seq === this.seq && Date.now() < deadline) {
      const tabId = this.state.tabId;
      if (tabId === undefined) return undefined;
      const frameId = frameFor(await this.deps.frames(tabId).catch(() => []), step);
      if (frameId !== undefined) {
        try {
          const parsed = schema.safeParse(await this.deps.send(tabId, msg, frameId));
          if (parsed.success) return parsed.data;
        } catch {
          // no script there yet (page loading) or the page went away mid-reply
        }
      }
      await this.deps.sleep(RETRY_MS);
    }
    return undefined;
  }

  private async show(): Promise<void> {
    clearTimeout(this.reshowTimer);
    const seq = ++this.seq;
    await this.clear();
    if (seq !== this.seq) return;
    const { index, total, mode } = this.state;
    if (index >= total) {
      await this.finish(true);
      return;
    }
    this.reach(index);
    const step = this.step;
    const tabId = this.state.tabId;
    if (!step || tabId === undefined) return;
    const plan = planStep(step);

    if (plan.kind === 'navigate') {
      const url = await this.deps.tabUrl(tabId);
      if (url && samePage(url, plan.url)) return this.advance(seq);
      if (mode === 'run') {
        this.set({ phase: 'acting' });
        await this.deps.navigate(tabId, plan.url);
        await this.deps.waitLoaded(tabId, PAGE_LOAD_TIMEOUT);
        if (seq === this.seq) await this.afterAct(seq);
        return;
      }
      this.set({ phase: 'navigate' });
      return;
    }

    // Desktop steps: the desktop app highlights them and reports when they are done.
    if (plan.kind === 'manual' && plan.reason === 'desktop' && this.deps.desktop?.available()) {
      this.set({ phase: 'manual', reason: 'desktop-app' });
      this.deps.desktop.show(step, index + 1, total);
      return;
    }

    const needsConfirm = step.agent.confirm && !this.confirmed.has(index);
    if (mode === 'run' && plan.kind === 'act' && !needsConfirm) return this.act(seq, step);

    // In Guide Me the person does every step, so secrets and uploads are highlighted like any
    // other; only steps with nothing to point at are "manual".
    const manual =
      plan.kind === 'manual' && (mode === 'run' || !['secret', 'upload'].includes(plan.reason));
    const phase = mode === 'run' && plan.kind === 'act' ? 'confirm' : manual ? 'manual' : 'showing';
    this.set({
      phase: phase === 'showing' ? 'finding' : phase,
      ...(plan.kind === 'manual' ? { reason: plan.reason } : {}),
    });
    if (!step.target) return;
    await this.revealFrame(step);
    const timeoutMs = step.agent.timeoutMs;
    const reply = await this.deliver(
      seq,
      step,
      { type: 'guide-show', step, number: index + 1, total, phase, timeoutMs },
      ShowReplySchema,
      timeoutMs + 5000,
    );
    if (seq !== this.seq || phase !== 'showing') return;
    this.set({ phase: reply?.found ? 'showing' : 'not-found' });
  }

  private async act(seq: number, step: Step): Promise<void> {
    this.set({ phase: 'acting' });
    await this.revealFrame(step);
    const timeoutMs = step.agent.timeoutMs;
    const value = valueFor(step, this.values);
    const reply = await this.deliver(
      seq,
      step,
      {
        type: 'guide-run',
        step,
        ...(value !== undefined ? { value } : {}),
        speed: this.state.speed,
        timeoutMs,
      },
      RunReplySchema,
      timeoutMs + 5000,
    );
    if (seq !== this.seq) return;
    if (reply?.result === 'acted') return this.afterAct(seq);
    if (reply?.result === 'cannot') {
      // Page events could not do it (e.g. a missing option): the person does this one.
      this.set({ phase: 'manual', reason: 'cannot' });
      const s = this.step;
      if (s) {
        const { index, total } = this.state;
        void this.deliver(
          seq,
          s,
          { type: 'guide-show', step: s, number: index + 1, total, phase: 'manual', timeoutMs },
          ShowReplySchema,
          timeoutMs,
        );
      }
      return;
    }
    this.set({ phase: 'failed', reason: 'not-found' });
  }

  /** Run for me: let the page settle, check expectations, then go on. */
  private async afterAct(seq: number): Promise<void> {
    const tabId = this.state.tabId;
    const step = this.step;
    if (tabId === undefined || !step) return;
    await this.deps.sleep(SPEED_DELAY[this.state.speed]);
    await this.deps.waitLoaded(tabId, PAGE_LOAD_TIMEOUT);
    if (seq !== this.seq) return;
    if (step.agent.expect?.length) {
      const reply = await this.deliver(
        seq,
        { ...step, app: { kind: 'web', url: step.app.kind === 'web' ? step.app.url : '' } },
        { type: 'guide-check', step },
        CheckReplySchema,
        5000,
      );
      if (seq !== this.seq) return;
      if (reply?.failed.length) {
        this.set({ phase: 'failed', reason: `expect:${reply.failed.join(', ')}` });
        return;
      }
    }
    this.state = { ...this.state, index: this.state.index + 1 };
    if (this.state.stepThrough && this.state.index < this.state.total) {
      this.reach(this.state.index);
      this.set({ phase: 'paused' });
      return;
    }
    await this.show();
  }

  private async advance(seq: number): Promise<void> {
    if (seq !== this.seq) return;
    this.state = { ...this.state, index: this.state.index + 1 };
    await this.show();
  }

  // ---------- Input from the person ----------

  async control(action: GuideControl): Promise<GuidanceState> {
    if (!this.isActive) {
      if (action === 'stop' && this.state.status === 'done') this.set({ ...GUIDANCE_IDLE });
      return this.state;
    }
    const run = this.state.mode === 'run';
    switch (action) {
      case 'next':
      case 'skip':
        this.state = { ...this.state, index: this.state.index + 1 };
        await this.show();
        break;
      case 'back': {
        const index = Math.max(0, this.state.index - 1);
        this.confirmed.delete(index);
        if (run) {
          this.seq++;
          await this.clear();
          this.set({ index, phase: 'paused' });
        } else {
          this.state = { ...this.state, index };
          await this.show();
        }
        break;
      }
      case 'stop':
        await this.finish(false);
        break;
      case 'pause':
        if (run) {
          this.seq++;
          await this.clear();
          this.set({ phase: 'paused' });
        }
        break;
      case 'resume':
      case 'retry':
      case 'step':
        await this.show();
        break;
      case 'confirm':
        this.confirmed.add(this.state.index);
        await this.show();
        break;
    }
    return this.state;
  }

  async goto(index: number): Promise<GuidanceState> {
    if (!this.isActive) return this.state;
    const i = Math.min(index, this.state.total - 1);
    if (this.state.mode === 'run') {
      this.seq++;
      await this.clear();
      this.set({ index: i, phase: 'paused' });
    } else {
      this.state = { ...this.state, index: i };
      await this.show();
    }
    return this.state;
  }

  setSpeed(speed: Speed, stepThrough: boolean): GuidanceState {
    this.set({ speed, stepThrough });
    return this.state;
  }

  /** The desktop app reports a desktop step done. */
  async desktopDone(stepId: string): Promise<void> {
    if (!this.isActive || this.step?.id !== stepId) return;
    this.state = { ...this.state, index: this.state.index + 1 };
    await this.show();
  }

  /** The person did the highlighted step (Guide Me, or a manual step in Run for me). */
  async stepDone(tabId: number, stepId: string): Promise<void> {
    if (!this.isActive || tabId !== this.state.tabId || this.step?.id !== stepId) return;
    if (this.state.phase === 'acting') return;
    const seq = this.seq;
    if (this.state.mode === 'run') {
      this.state = { ...this.state, index: this.state.index + 1 };
      if (seq !== this.seq) return;
      await this.show();
      return;
    }
    await this.advance(seq);
  }

  /**
   * A page or frame loaded in the guided tab. A new top page, or a reload of the frame the
   * current step lives in, replaced the highlight, so show the step again. Other frames
   * loading (ads, widgets) leave it alone.
   */
  pageLoaded(tabId: number, frameId: number, url: string): void {
    if (!this.isActive || tabId !== this.state.tabId) return;
    if (!['showing', 'not-found', 'manual', 'confirm', 'navigate'].includes(this.state.phase))
      return;
    const step = this.step;
    const own =
      frameId === 0 ||
      (step?.app.kind === 'web' && !!step.app.frameUrl && samePage(step.app.frameUrl, url));
    if (!own) return;
    clearTimeout(this.reshowTimer);
    this.reshowTimer = setTimeout(() => void this.show(), 150);
  }

  /** Guidance follows the person to another tab (a link that opened a new tab, say). */
  async tabActivated(tabId: number): Promise<void> {
    if (!this.isActive || tabId === this.state.tabId) return;
    const url = await this.deps.tabUrl(tabId);
    if (!url || !/^(https?|file):/.test(url)) return;
    await this.clear();
    this.set({ tabId });
    if (this.state.phase !== 'acting' && this.state.phase !== 'paused') await this.show();
  }

  tabClosed(tabId: number): void {
    if (this.isActive && tabId === this.state.tabId) void this.finish(false);
  }
}
