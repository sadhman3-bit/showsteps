import {
  attachAhead,
  createId,
  guideSteps,
  needsSignIn,
  parseAnalytics,
  planGuideStep,
  recordRun,
  samePage,
  stepNumbers,
  valueFor,
  type AttachSource,
  type Guide,
  type GuideStore,
  type Run,
  type RunStepLog,
  type Step,
} from '@showsteps/core';
import {
  RunAttachments,
  type AttachDeps,
  type DownloadInfo,
  type FileLookup,
  type RunFileMeta,
} from './attachments';
import { base64ToBytes, blobToBase64 } from './fileData';
import type { z } from 'zod';
import {
  CheckReplySchema,
  GUIDANCE_IDLE,
  RunReplySchema,
  ShowReplySchema,
  SignInReplySchema,
  type FileHint,
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
  /** Attaching files a run downloaded (1.2): the run's file store and how files are fetched. */
  attach?: Omit<AttachDeps, 'now'> & { hasDownloadAccess(): Promise<boolean> };
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
  approved?: string[];
  windowId?: number;
  /** Files kept for attach steps (their contents are in the run file store). */
  files?: RunFileMeta[];
  /** The run watches Chrome's downloads (it had download access when it started). */
  watch?: boolean;
}

export interface StartOptions {
  /** Confirm steps that run without stopping: a schedule's approvals, for this guide version. */
  approved?: readonly string[];
  /** The schedule this run is for. It stays in `windowId` and doesn't follow other tabs. */
  scheduleId?: string;
  windowId?: number;
  /**
   * Started from a link in an exported file (1.2): the tab goes to the exact start page first,
   * which drops the link's marker and restores the site's own fragment.
   */
  fromLink?: boolean;
}

/** Pause between Run for me steps, and how long the cursor takes to travel. */
export const CHECK_ATTEMPTS = 4;
const CHECK_RETRY_MS = 750;
const SPEED_DELAY: Record<Speed, number> = { slow: 1400, normal: 700, fast: 250 };
const PAGE_LOAD_TIMEOUT = 15_000;
const RETRY_MS = 250;

/** A URL's host name, or '' when it isn't a URL (`URL.canParse` needs Chrome 120). */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

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
  private guide: Guide | undefined;
  private steps: Step[] = [];
  /** Files this run downloaded, while an attach step is ahead (1.2). */
  private files: RunAttachments | undefined;
  /** The run watches Chrome's downloads for files (download access was on at the start). */
  private watch = false;
  /** The guided tab's address before the last click (downloads must come from its site). */
  private site = '';
  /** Files attached in this run, by the attach step's ID (for run logs). */
  private readonly attached = new Map<string, RunFileMeta>();
  private values: Record<string, string> = {};
  private run: Run | undefined;
  private confirmed = new Set<number>();
  private approved = new Set<string>();
  /** A scheduled run's own window: guidance never moves to tabs outside it. */
  private ownWindow: number | undefined;
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
    if (!patch.file && 'phase' in patch) delete this.state.file;
    // A copy: listeners may read it later, after this session's state has moved on.
    this.deps.broadcast({ ...this.state });
    void this.save();
  }

  private async save(): Promise<void> {
    await this.deps.persist(
      this.state.status === 'active' && this.run
        ? {
            state: this.state,
            values: this.values,
            run: this.run,
            ...(this.approved.size ? { approved: [...this.approved] } : {}),
            ...(this.ownWindow !== undefined ? { windowId: this.ownWindow } : {}),
            ...(this.files ? { files: this.files.metas, watch: this.watch } : {}),
          }
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

  async start(
    msg: Extract<GuidePageMessage, { type: 'guide-start' }>,
    options: StartOptions = {},
  ): Promise<GuidanceState> {
    if (this.isActive) await this.finish(false, 'replaced');
    const guide = await this.deps.store.getGuide(msg.guideId);
    if (!guide) throw new Error('not-found');
    const steps = guideSteps(guide);
    const first = steps.find((s) => s.app.kind === 'web');
    if (!first || first.app.kind !== 'web') throw new Error('no-web-steps');
    const startUrl = first.app.url;

    let tabId = msg.tabId;
    const currentUrl = tabId === undefined ? undefined : await this.deps.tabUrl(tabId);
    if (options.fromLink && tabId !== undefined) {
      await this.deps.navigate(tabId, startUrl);
      await this.deps.waitLoaded(tabId, PAGE_LOAD_TIMEOUT);
    } else if (options.scheduleId && tabId !== undefined) {
      // A scheduled run's window was opened on the first page for it: stay in that tab even if
      // the site redirected it (to sign in, say). The first step takes it where it should be.
    } else if (tabId === undefined || !currentUrl || !/^(https?|file):/.test(currentUrl)) {
      tabId = await this.deps.openTab(startUrl, msg.windowId);
    } else if (!samePage(currentUrl, startUrl) && (msg.from ?? 0) === 0) {
      // The first step's page is somewhere else: open it next to the current tab.
      tabId = await this.deps.openTab(startUrl, msg.windowId);
    }

    this.guide = guide;
    this.steps = steps;
    this.values = msg.values ?? {};
    this.confirmed = new Set();
    this.approved = new Set(options.approved ?? []);
    this.ownWindow = options.scheduleId ? (options.windowId ?? msg.windowId) : undefined;
    this.run = {
      id: createId(),
      mode: msg.mode,
      startedAt: this.deps.now(),
      reached: 0,
      total: steps.length,
      completed: false,
    };
    // Only a run with an attach step ahead keeps files; Guide Me never does.
    this.attached.clear();
    this.files =
      msg.mode === 'run' ? this.attachments(this.run.id, attachAhead(guide, -1)) : undefined;
    this.watch = !!this.files && !!(await this.deps.attach?.hasDownloadAccess().catch(() => false));
    this.site = '';
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
      ...(options.scheduleId ? { scheduleId: options.scheduleId } : {}),
    };
    void this.recordRun();
    void this.show();
    return this.state;
  }

  /** End the session. `reason` says why one ended early: stopped, closed (its tab) or replaced. */
  async finish(completed: boolean, reason?: 'stopped' | 'closed' | 'replaced'): Promise<void> {
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
    this.approved = new Set();
    this.ownWindow = undefined;
    void this.files?.dispose();
    this.files = undefined;
    this.watch = false;
    const ended: Partial<GuidanceState> = completed
      ? { status: 'done', phase: 'finding' }
      : { ...GUIDANCE_IDLE, ...(reason ? { reason } : {}) };
    this.set(ended);
    if (!completed) delete this.state.scheduleId;
  }

  /** After a worker restart: carry on where the session was (Run for me waits, paused). */
  async restore(data: PersistedGuidance): Promise<void> {
    const guide = data.state.guideId
      ? await this.deps.store.getGuide(data.state.guideId)
      : undefined;
    if (!guide) return;
    this.guide = guide;
    this.steps = guideSteps(guide);
    this.values = data.values;
    this.run = data.run;
    this.files = data.files ? this.attachments(data.run.id, true, data.files) : undefined;
    this.watch = !!this.files && !!data.watch;
    this.approved = new Set(data.approved ?? []);
    this.ownWindow = data.windowId;
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
    const plan = this.guide ? planGuideStep(this.guide, step) : ({ kind: 'act' } as const);

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

    const needsConfirm =
      step.agent.confirm && !this.confirmed.has(index) && !this.approved.has(step.id);
    if (mode === 'run' && plan.kind === 'act' && !needsConfirm) return this.act(seq, step);
    if (mode === 'run' && plan.kind === 'attach' && !needsConfirm)
      return this.attachStep(seq, step, plan.from);

    // In Guide Me the person does every step, so secrets and uploads are highlighted like any
    // other; only steps with nothing to point at are "manual".
    const manual =
      plan.kind === 'manual' && (mode === 'run' || !['secret', 'upload'].includes(plan.reason));
    const phase =
      mode === 'run' && (plan.kind === 'act' || plan.kind === 'attach')
        ? 'confirm'
        : manual
          ? 'manual'
          : 'showing';
    this.set({
      phase: phase === 'showing' ? 'finding' : phase,
      ...(plan.kind === 'manual' ? { reason: plan.reason } : {}),
    });
    if (!step.target) return;
    await this.revealFrame(step);
    const timeoutMs = step.agent.timeoutMs;
    const hint = plan.kind === 'attach' ? this.sourceHint(plan.from) : undefined;
    const reply = await this.deliver(
      seq,
      step,
      {
        type: 'guide-show',
        step,
        number: index + 1,
        total,
        phase,
        timeoutMs,
        ...(hint ? { hint } : {}),
      },
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
    // A later step attaches a download: this click's download (if any) belongs to the run.
    const files =
      this.files && this.guide && attachAhead(this.guide, this.state.index)
        ? this.files
        : undefined;
    if (files) {
      const tabId = this.state.tabId;
      this.site = (tabId !== undefined ? await this.deps.tabUrl(tabId) : undefined) ?? '';
      files.noteClick(step.id);
    }
    const reply = await this.deliver(
      seq,
      step,
      {
        type: 'guide-run',
        step,
        ...(value !== undefined ? { value } : {}),
        speed: this.state.speed,
        timeoutMs,
        ...(files ? { grab: { fetchLink: !this.watch } } : {}),
      },
      RunReplySchema,
      timeoutMs + 5000,
    );
    if (seq !== this.seq) return;
    if (files && reply?.file) {
      const { name, type, data } = reply.file;
      const blob = new Blob([base64ToBytes(data)], { type });
      await files.keep(step.id, blob, name, hostOf(this.site) || undefined);
      void this.save();
    } else if (files && reply?.tooBig) files.tooBig(step.id, reply.tooBig.name);
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
    if (await this.signInStop(seq, step)) return;
    if (seq !== this.seq) return;
    this.set({ phase: 'failed', reason: 'not-found' });
  }

  // ---------- Attaching downloaded files (1.2) ----------

  private attachments(
    runId: string,
    wanted: boolean,
    files: readonly RunFileMeta[] = [],
  ): RunAttachments | undefined {
    const deps = this.deps.attach;
    if (!wanted || !deps) return undefined;
    return new RunAttachments(runId, { ...deps, now: () => Date.now() }, () => this.site, files);
  }

  /** The file attached at a step of the latest run, for its run log (never the contents). */
  attachedFile(stepId: string): RunStepLog['file'] {
    const meta = this.attached.get(stepId);
    if (!meta) return undefined;
    const step = this.guide ? stepNumbers(this.guide).get(meta.stepId) : undefined;
    return {
      name: meta.name,
      size: meta.size,
      ...(meta.from ? { from: meta.from } : {}),
      ...(step ? { step } : {}),
    };
  }

  /** `downloads.onCreated` (only while a run with download access has an attach step ahead). */
  downloadCreated(item: DownloadInfo): void {
    if (!this.isActive || !this.watch || !this.files) return;
    if (this.files.downloadCreated(item)) void this.save();
  }

  /** `downloads.onChanged`: a download finished or failed. */
  downloadEnded(item: DownloadInfo): void {
    if (!this.isActive || !this.watch || !this.files) return;
    void this.files.downloadEnded(item).then(() => this.save());
  }

  /** The step number an attach source names (undefined for the latest download). */
  private sourceNumber(from: AttachSource): number | undefined {
    if (from.download === 'latest' || !this.guide) return undefined;
    return stepNumbers(this.guide).get(from.download);
  }

  /** Guide Me's tooltip line for an attach step: which download to choose. */
  private sourceHint(from: AttachSource): FileHint {
    const step = this.sourceNumber(from);
    return step ? { step } : {};
  }

  /** The file's name (or the one recorded) and the step it came from, for messages. */
  private hintFor(step: Step, from: AttachSource, found: FileLookup): FileHint {
    const name =
      found.kind === 'ready'
        ? found.meta.name
        : 'name' in found && found.name
          ? found.name
          : step.input?.value;
    const sourceId = found.kind === 'ready' ? found.meta.stepId : found.stepId;
    const number =
      (sourceId && this.guide ? stepNumbers(this.guide).get(sourceId) : undefined) ??
      this.sourceNumber(from);
    const sites =
      found.kind === 'problem' && found.from && found.site
        ? { from: found.from, site: found.site }
        : {};
    return { ...(name ? { name } : {}), ...(number ? { step: number } : {}), ...sites };
  }

  /**
   * Run for me at an attach step: put the file the run downloaded into the field. While it is
   * still downloading, wait (up to the step's timeout); without it, stop for the person.
   */
  private async attachStep(seq: number, step: Step, from: AttachSource): Promise<void> {
    const timeoutMs = step.agent.timeoutMs;
    const index = this.state.index;
    const look = (): FileLookup => this.files?.lookup(from, this.steps, index) ?? { kind: 'none' };
    let found = look();
    if (found.kind === 'pending') {
      this.set({ phase: 'acting', reason: 'file-wait', file: this.hintFor(step, from, found) });
      const deadline = Date.now() + timeoutMs;
      while (found.kind === 'pending' && Date.now() < deadline && seq === this.seq) {
        await this.deps.sleep(RETRY_MS);
        found = look();
      }
      if (seq !== this.seq) return;
    }
    const hint = this.hintFor(step, from, found);
    const blob = found.kind === 'ready' ? await this.files?.blob(found.meta) : undefined;
    if (seq !== this.seq) return;
    if (found.kind !== 'ready' || !blob) {
      const reason =
        found.kind === 'problem'
          ? `file-${found.problem}`
          : found.kind === 'pending'
            ? 'file-slow'
            : this.watch &&
                !(found.kind === 'none' && found.stepId && this.files?.sawDownload(found.stepId))
              ? 'file-none'
              : 'file-missing';
      return this.stopForPerson(seq, step, reason, hint);
    }
    this.set({ phase: 'acting', file: hint });
    await this.revealFrame(step);
    const reply = await this.deliver(
      seq,
      step,
      {
        type: 'guide-run',
        step,
        speed: this.state.speed,
        timeoutMs,
        attach: { name: found.meta.name, type: found.meta.type, data: await blobToBase64(blob) },
      },
      RunReplySchema,
      timeoutMs + 5000,
    );
    if (seq !== this.seq) return;
    if (reply?.result === 'acted') {
      this.attached.set(step.id, found.meta);
      return this.afterAct(seq);
    }
    if (reply?.result === 'cannot')
      return this.stopForPerson(
        seq,
        step,
        reply.reason === 'file-type' ? 'file-type' : 'cannot',
        hint,
      );
    if (await this.signInStop(seq, step)) return;
    if (seq !== this.seq) return;
    this.set({ phase: 'failed', reason: 'not-found' });
  }

  /** Run for me stops at a step for the person, saying why, and highlights it if it can. */
  private async stopForPerson(
    seq: number,
    step: Step,
    reason: string,
    file?: FileHint,
  ): Promise<void> {
    this.set({ phase: 'manual', reason, ...(file ? { file } : {}) });
    if (!step.target) return;
    const { index, total } = this.state;
    await this.revealFrame(step);
    void this.deliver(
      seq,
      step,
      {
        type: 'guide-show',
        step,
        number: index + 1,
        total,
        phase: 'manual',
        timeoutMs: step.agent.timeoutMs,
        ...(file ? { hint: file } : {}),
      },
      ShowReplySchema,
      step.agent.timeoutMs,
    );
  }

  /**
   * The step's element wasn't found: if the page now is a sign-in page on another host (the
   * session ended and the app sent the person to sign in), stop with "Sign in, then press
   * Continue". Run for me never types passwords or codes, so the person signs in themselves.
   */
  private async signInStop(seq: number, step: Step): Promise<boolean> {
    const tabId = this.state.tabId;
    if (tabId === undefined || step.app.kind !== 'web') return false;
    const reply = SignInReplySchema.safeParse(
      await this.deps.send(tabId, { type: 'guide-signin' }, 0).catch(() => undefined),
    );
    if (seq !== this.seq || !reply.success) return false;
    const stepHost = hostOf(step.app.url);
    if (
      !stepHost ||
      !needsSignIn({ host: reply.data.host, stepHost, hasSecretField: reply.data.secretField })
    )
      return false;
    this.set({ phase: 'failed', reason: 'sign-in' });
    void this.deps.send(tabId, { type: 'guide-notice', kind: 'sign-in' }, 0).catch(() => undefined);
    return true;
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
      // Results can take a moment to appear (a dialog animating in, a message after a save).
      let reply: { failed: string[] } | undefined;
      for (let attempt = 0; attempt < CHECK_ATTEMPTS; attempt++) {
        if (attempt) await this.deps.sleep(CHECK_RETRY_MS);
        // The top page checks its expectations; the step's iframe checks those marked for it.
        const top = await this.deliver(
          seq,
          { ...step, app: { kind: 'web', url: step.app.kind === 'web' ? step.app.url : '' } },
          { type: 'guide-check', step },
          CheckReplySchema,
          5000,
        );
        const inFrame =
          step.app.kind === 'web' &&
          step.app.frameUrl &&
          step.agent.expect?.some((e) => 'inFrame' in e && e.inFrame)
            ? await this.deliver(seq, step, { type: 'guide-check', step }, CheckReplySchema, 5000)
            : undefined;
        if (seq !== this.seq) return;
        reply =
          top || inFrame
            ? { failed: [...(top?.failed ?? []), ...(inFrame?.failed ?? [])] }
            : undefined;
        if (!reply?.failed.length) break;
      }
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
        await this.finish(false, 'stopped');
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
  async tabActivated(tabId: number, windowId?: number): Promise<void> {
    if (!this.isActive || tabId === this.state.tabId) return;
    if (this.ownWindow !== undefined && windowId !== this.ownWindow) return;
    const url = await this.deps.tabUrl(tabId);
    if (!url || !/^(https?|file):/.test(url)) return;
    await this.clear();
    this.set({ tabId });
    if (this.state.phase !== 'acting' && this.state.phase !== 'paused') await this.show();
  }

  tabClosed(tabId: number): void {
    if (this.isActive && tabId === this.state.tabId) void this.finish(false, 'closed');
  }
}
