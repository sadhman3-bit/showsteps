import {
  CaptureSession,
  attachScreenshot,
  createGuide,
  isRemoteProcess,
  expectationsFrom,
  nowIso,
  scalePageText,
  serializePageText,
  wordsFileFor,
  type AppContext,
  type CaptureEvent,
  type Guide,
  type Expectation,
  type GuideStore,
  type InputMode,
  type PageText,
  type ShotInfo,
  type Step,
} from '@trailmark/core';
import type { FrameRegistry } from './frames';
import { IDLE_STATE, type CaptureState, type ContentEvent, type ControlAction } from './messages';
import { ShotLimiter, type EncodedShot, type PendingShot } from './shots';

/** A desktop app screenshot sent over the bridge. */
export interface DesktopShot {
  full: Uint8Array;
  thumb: Uint8Array;
  width: number;
  height: number;
  scale: number;
}

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
}

export interface ShotOptions {
  /** Known window of the tab (saves a lookup on the hot path). */
  windowId?: number;
  /** The page already hid Trailmark's controls and painted, so no round trip is needed. */
  uiHidden?: boolean;
  /** When the input happened (epoch ms, from the page). */
  inputAt?: number;
}

export interface RecorderDeps {
  store: GuideStore;
  frames: FrameRegistry;
  /** chrome.tabs.captureVisibleTab for the window holding the tab. */
  captureVisibleTab(tabId: number, opts: ShotOptions): Promise<string>;
  encode(dataUrl: string): Promise<EncodedShot>;
  /** Push state to every frame of a tab's content scripts. */
  sendState(tabId: number, state: CaptureState): void;
  /** Push state to extension pages. */
  broadcastState(state: CaptureState): void;
  libraryChanged(): void;
  persist(data: PersistedRecorder | null): Promise<void>;
  limiter?: ShotLimiter;
  /** Shown as "last edited by" in shared libraries. */
  user?: string;
  maxZoom?: number;
}

/** What survives a service-worker restart (chrome.storage.session). */
export interface PersistedRecorder {
  state: CaptureState;
  guideId: string;
  isNew: boolean;
  insertAt?: number;
  addedStepIds: string[];
  lastShot?: ShotInfo & { stepId: string };
  viewports: [number, Viewport][];
  tabs: number[];
  frames: [string, string][];
}

export interface EventSender {
  tabId: number;
  frameId: number;
  tabUrl: string;
  tabTitle?: string;
  frameUrl?: string;
}

const PENDING_SHOT_TTL_MS = 30_000;
/** How long an event waits for a screenshot request that its page said is on the way. */
const SHOT_ARRIVAL_WAIT_MS = 500;
/** A new page this soon after a step's action is that action's result (U6). */
const PAGE_CHANGE_WINDOW_MS = 3000;

/**
 * The background's capture engine: turns content-script events into saved steps with
 * screenshots, one capture session at a time. All work is serialised through a queue.
 */
export class Recorder {
  private state: CaptureState = { ...IDLE_STATE };
  private session: CaptureSession | undefined;
  private guide: Guide | undefined;
  private base: Guide['blocks'] = [];
  private isNew = false;
  private lastShot: (ShotInfo & { stepId: string }) | undefined;
  private readonly pending = new Map<string, { shot: Promise<PendingShot>; at: number }>();
  /** Word positions sent with a picture request (shot id → words), for Secure Blur. */
  private readonly wordsByShot = new Map<string, PageText>();
  /** Pictures saved before their word positions arrived (shot id → picture). */
  private readonly awaitingWords = new Map<
    string,
    { file: string; width: number; height: number; scale: number }
  >();
  /** Steps waiting for the page to say what their action changed (observe id → step id). */
  private readonly observing = new Map<string, string>();
  private lastActed: { tabId: number; stepId: string; at: number } | undefined;
  /** Events that arrived before their screenshot request, waiting for it (shot id → wake-up). */
  private readonly waiting = new Map<string, () => void>();
  private readonly viewports = new Map<number, Viewport>();
  /** Last time each tab committed a top-level navigation (a new page). */
  private readonly navigatedAt = new Map<number, number>();
  private readonly tabs = new Set<number>();
  private readonly limiter: ShotLimiter;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: RecorderDeps) {
    this.limiter = deps.limiter ?? new ShotLimiter();
  }

  get current(): CaptureState {
    return { ...this.state };
  }

  /** Tabs with content scripts taking part in this capture. */
  get trackedTabs(): number[] {
    return [...this.tabs];
  }

  get isActive(): boolean {
    return this.state.status !== 'idle';
  }

  /** Run `fn` after all earlier work, so events are applied in arrival order. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  // ---------- Lifecycle ----------

  start(opts: {
    tabId: number;
    url: string;
    title?: string;
    guideId?: string;
    insertAt?: number;
    viewport?: Viewport;
    /** For a new guide: how typed values are used (U4). */
    defaultInputMode?: InputMode;
  }): Promise<CaptureState> {
    return this.serial(async () => {
      if (this.isActive) return this.current;
      let guide: Guide | undefined;
      if (opts.guideId) {
        guide = await this.deps.store.getGuide(opts.guideId);
        if (!guide) throw new Error('That guide no longer exists.');
        this.isNew = false;
      } else {
        guide = createGuide({
          title: opts.title?.trim() || hostOf(opts.url) || 'New guide',
          settings: { defaultInputMode: opts.defaultInputMode ?? 'fixed' },
        });
        if (this.deps.user) guide.author = this.deps.user;
        this.isNew = true;
      }
      this.guide = guide;
      this.base = guide.blocks;
      const insertAt = opts.guideId ? opts.insertAt : undefined;
      this.session = new CaptureSession(insertAt, guide.settings.defaultInputMode);
      this.lastShot = undefined;
      this.pending.clear();
      this.tabs.clear();
      this.tabs.add(opts.tabId);
      if (opts.viewport) this.viewports.set(opts.tabId, opts.viewport);
      this.state = {
        status: 'recording',
        guideId: guide.id,
        title: guide.title,
        stepCount: 0,
        liveBlur: false,
      };

      if (this.isNew) {
        // First step: where the process starts.
        const shot = await this.takeShot(opts.tabId);
        await this.applyEvent(
          { kind: 'navigate', app: webApp(opts.url, opts.title), at: nowIso(), tabId: opts.tabId },
          shot,
        );
      }
      await this.save();
      this.publish();
      return this.current;
    });
  }

  control(action: ControlAction): Promise<CaptureState> {
    return this.serial(async () => {
      if (!this.isActive) return this.current;
      switch (action) {
        case 'pause':
          this.state.status = 'paused';
          break;
        case 'resume':
          this.state.status = 'recording';
          break;
        case 'toggle-live-blur':
          this.state.liveBlur = !this.state.liveBlur;
          break;
        case 'delete-last':
          await this.deleteLast();
          break;
        case 'finish':
          await this.finish();
          return this.current;
        case 'cancel':
          await this.cancel();
          return this.current;
      }
      await this.persist();
      this.publish();
      return this.current;
    });
  }

  private async deleteLast(): Promise<void> {
    const step = this.session?.deleteLast();
    if (!step || !this.guide || !this.session) return;
    this.state.stepCount = this.session.count;
    await this.deleteStepImages([step]);
    if (this.lastShot?.stepId === step.id) this.lastShot = undefined;
    await this.save();
  }

  private async finish(): Promise<void> {
    const guideId = this.guide?.id;
    if (this.guide && this.session) {
      if (this.isNew && this.session.count === 0) {
        await this.deps.store.purgeGuide(this.guide.id);
      } else {
        await this.save(true);
      }
    }
    const tabs = [...this.tabs];
    this.reset();
    this.state = { ...IDLE_STATE, ...(guideId ? { lastFinishedGuideId: guideId } : {}) };
    await this.deps.persist(null);
    for (const tabId of tabs) this.deps.sendState(tabId, this.current);
    this.deps.broadcastState(this.current);
    this.deps.libraryChanged();
  }

  private async cancel(): Promise<void> {
    if (this.guide && this.session) {
      if (this.isNew) {
        await this.deps.store.purgeGuide(this.guide.id);
      } else {
        const removed = this.session.clear();
        await this.deleteStepImages(removed);
        await this.deps.store.saveGuide({ ...this.guide, blocks: this.base }, { snapshot: false });
      }
    }
    const tabs = [...this.tabs];
    this.reset();
    this.state = { ...IDLE_STATE };
    await this.deps.persist(null);
    for (const tabId of tabs) this.deps.sendState(tabId, this.current);
    this.deps.broadcastState(this.current);
    this.deps.libraryChanged();
  }

  private reset(): void {
    this.session = undefined;
    this.guide = undefined;
    this.base = [];
    this.lastShot = undefined;
    this.pending.clear();
    this.wordsByShot.clear();
    this.awaitingWords.clear();
    this.observing.clear();
    this.lastActed = undefined;
    this.tabs.clear();
  }

  // ---------- Content-script input ----------

  /** A tab whose content script said hello: remember it so state updates reach it. */
  noteTab(tabId: number): void {
    if (!this.isActive || this.tabs.has(tabId)) return;
    this.tabs.add(tabId);
    void this.persist();
  }

  /** A tab committed a new top-level page. */
  noteNavigation(tabId: number, at = Date.now()): void {
    this.navigatedAt.set(tabId, at);
  }

  setViewport(tabId: number, viewport: Viewport): void {
    this.viewports.set(tabId, viewport);
  }

  /** Take (or skip, under the rate limit) the screenshot for an upcoming event. */
  shot(tabId: number, shotId: string, opts: ShotOptions = {}): Promise<void> {
    if (this.state.status !== 'recording') return Promise.resolve();
    // Not serialised: the screenshot must be taken now, before the page changes. The matching
    // event may arrive before the capture finishes; it waits on this promise.
    const shot = this.takeShot(tabId, opts);
    this.pending.set(shotId, { shot, at: Date.now() });
    this.waiting.get(shotId)?.();
    this.prunePending();
    return shot.then(() => undefined);
  }

  /**
   * A step recorded by the desktop app during this capture (shared session): the desktop app
   * sends events and pictures, and this recorder stays the guide's only writer.
   */
  desktopEvent(ev: CaptureEvent, shot: DesktopShot | undefined): Promise<void> {
    return this.serial(async () => {
      if (this.state.status !== 'recording' || !this.session || !this.guide) return;
      const result = this.session.apply(ev);
      for (const removed of result.removed) await this.deleteStepImages([removed]);
      const step = result.step;
      if (step.app.kind === 'desktop' && isRemoteProcess(step.app.processName))
        step.agent.visualOnly = true;
      if (result.wantsShot && shot) {
        const name = `${step.id}.png`;
        await this.deps.store.putImage(this.guide.id, name, shot.full);
        await this.deps.store.putImage(this.guide.id, `${step.id}.thumb.png`, shot.thumb);
        const info: ShotInfo = {
          file: `img/${name}`,
          width: shot.width,
          height: shot.height,
          dpr: shot.scale,
          scale: 1, // desktop targets are already in picture pixels
        };
        attachScreenshot(step, info, this.deps.maxZoom);
        this.lastShot = { ...info, stepId: step.id };
      } else if (result.wantsShot) {
        await this.attachShot(step, undefined);
      }
      this.state.stepCount = this.session.count;
      await this.save();
      this.publish();
    });
  }

  event(sender: EventSender, ev: ContentEvent, shotId?: string, observeId?: string): Promise<void> {
    return this.serial(async () => {
      if (this.state.status !== 'recording') return;
      const entry = shotId ? await this.pendingShot(shotId) : undefined;
      if (shotId) this.pending.delete(shotId);
      const taken = entry ? await entry.shot : undefined;
      const words = shotId ? this.wordsByShot.get(shotId) : undefined;
      if (shotId) this.wordsByShot.delete(shotId);
      const shot = taken?.kind === 'captured' && words ? { ...taken, words } : taken;
      const step = await this.applyContentEvent(sender, ev, shot);
      // Word positions still on their way (a busy machine): saved when they arrive.
      const picture = step?.human.screenshot;
      if (shotId && !words && taken?.kind === 'captured' && picture && !picture.reusedFromStepId)
        this.awaitingWords.set(shotId, {
          file: picture.file,
          width: picture.width,
          height: picture.height,
          scale: taken.viewportWidth > 0 ? picture.width / taken.viewportWidth : taken.dpr,
        });
      if (this.awaitingWords.size > 20) {
        const oldest = this.awaitingWords.keys().next().value;
        if (oldest !== undefined) this.awaitingWords.delete(oldest);
      }
      if (step && observeId) {
        this.observing.set(observeId, step.id);
        this.lastActed = { tabId: sender.tabId, stepId: step.id, at: Date.now() };
      }
      await this.save();
      this.publish();
    });
  }

  /** The words on screen when a picture was asked for (top frame). */
  shotWords(shotId: string, words: PageText): void {
    if (this.state.status !== 'recording') return;
    const late = this.awaitingWords.get(shotId);
    if (late) {
      this.awaitingWords.delete(shotId);
      void this.serial(async () => {
        if (!this.guide) return;
        const page = scalePageText(words, late.scale, late.width, late.height);
        await this.deps.store.putImage(
          this.guide.id,
          wordsFileFor(late.file),
          serializePageText(page),
        );
      });
      return;
    }
    this.wordsByShot.set(shotId, words);
    // Never more than a handful are waiting; drop the oldest beyond that.
    if (this.wordsByShot.size > 20) {
      const oldest = this.wordsByShot.keys().next().value;
      if (oldest !== undefined) this.wordsByShot.delete(oldest);
    }
  }

  /** U6: what changed on the page after a step's action (sent by the page ~800 ms later). */
  observed(observeId: string, expect: Expectation[]): Promise<void> {
    return this.serial(async () => {
      const stepId = this.observing.get(observeId);
      this.observing.delete(observeId);
      const step = this.session?.steps.find((s) => s.id === stepId);
      if (!step || !expect.length) return;
      const known = new Set((step.agent.expect ?? []).map((e) => JSON.stringify(e)));
      const add = expect.filter((e) => !known.has(JSON.stringify(e)));
      if (!add.length) return;
      step.agent.expect = [...(step.agent.expect ?? []), ...add].slice(0, 3);
      await this.save();
    });
  }

  /**
   * A page in a recorded tab was replaced by a link or form shortly after a step: the new
   * address is that step's expected result (the old page could not report it).
   */
  pageChanged(tabId: number, url: string): Promise<void> {
    return this.serial(async () => {
      const last = this.lastActed;
      if (!last || last.tabId !== tabId || Date.now() - last.at > PAGE_CHANGE_WINDOW_MS) return;
      const step = this.session?.steps.find((s) => s.id === last.stepId);
      if (!step || step.agent.expect?.some((e) => e.type === 'url')) return;
      const after = expectationsFrom(
        { url: step.app.kind === 'web' ? step.app.url : '', landmarks: [], messages: [] },
        { url, landmarks: [], messages: [] },
      );
      if (!after.length) return;
      step.agent.expect = [...after, ...(step.agent.expect ?? [])].slice(0, 3);
      await this.save();
    });
  }

  /**
   * The user switched away from a tab: collect typing it has not committed yet and record it
   * before anything that follows. `collect` asks each frame of the tab for its pending event.
   */
  flush(collect: () => Promise<{ sender: EventSender; event: ContentEvent }[]>): Promise<void> {
    return this.serial(async () => {
      if (this.state.status !== 'recording') return;
      const pending = await collect().catch(() => []);
      if (!pending.length) return;
      // No new screenshot: another tab is in front now. The step reuses the last one.
      for (const p of pending) await this.applyContentEvent(p.sender, p.event, { kind: 'skipped' });
      await this.save();
      this.publish();
    });
  }

  private async applyContentEvent(
    sender: EventSender,
    ev: ContentEvent,
    shot: PendingShot | undefined,
  ): Promise<Step | undefined> {
    const mapped = await this.mapToTop(sender, ev);
    if (!mapped) return undefined;
    const app: AppContext = webApp(
      sender.tabUrl,
      sender.tabTitle,
      sender.frameId !== 0 ? sender.frameUrl : undefined,
    );
    const captureEvent = { ...mapped, app, at: nowIso(), tabId: sender.tabId } as CaptureEvent;
    return this.applyEvent(captureEvent, shot);
  }

  /** A navigation the user made directly (address bar, back/forward). */
  navigated(tabId: number, url: string, title?: string): Promise<void> {
    return this.serial(async () => {
      if (this.state.status !== 'recording') return;
      const shot = await this.takeShot(tabId);
      await this.applyEvent(
        { kind: 'navigate', app: webApp(url, title), at: nowIso(), tabId },
        shot,
      );
      await this.save();
      this.publish();
    });
  }

  // ---------- Internals ----------

  /**
   * The screenshot for an event. The page sends the event first (it may be about to unload)
   * and the screenshot request right after its toolbar is hidden, so allow a short wait.
   */
  private async pendingShot(shotId: string) {
    if (!this.pending.has(shotId)) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SHOT_ARRIVAL_WAIT_MS);
        this.waiting.set(shotId, () => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.waiting.delete(shotId);
    }
    return this.pending.get(shotId);
  }

  private async takeShot(tabId: number, opts: ShotOptions = {}): Promise<PendingShot> {
    if (!this.limiter.tryAcquire()) return { kind: 'skipped' };
    try {
      const asked = opts.inputAt ?? Date.now();
      const dataUrl = await this.deps.captureVisibleTab(tabId, opts);
      // Capturing can take a few hundred ms on a busy machine. If the page was replaced by a new
      // one meanwhile (e.g. a sign-in click), the picture shows the wrong page: reuse the
      // previous screenshot instead, which shows this page moments earlier.
      if ((this.navigatedAt.get(tabId) ?? 0) >= asked) return { kind: 'skipped' };
      const vp = this.viewports.get(tabId);
      return {
        kind: 'captured',
        dataUrl,
        viewportWidth: vp?.width ?? 0,
        dpr: vp?.dpr ?? 1,
      };
    } catch {
      // e.g. the tab is not visible or not capturable; fall back to reuse.
      return { kind: 'skipped' };
    }
  }

  private prunePending(): void {
    const cutoff = Date.now() - PENDING_SHOT_TTL_MS;
    for (const [id, p] of this.pending) if (p.at < cutoff) this.pending.delete(id);
  }

  /** Shift frame-local coordinates into the top viewport and record the frame chain. */
  private async mapToTop<E extends ContentEvent>(sender: EventSender, ev: E): Promise<E | null> {
    if (sender.frameId === 0 || !('target' in ev) || !ev.target) return ev;
    const pos = await this.deps.frames.resolve(sender.tabId, sender.frameId);
    if (!pos) return ev; // unknown chain: keep frame-local geometry rather than drop the step
    const t = ev.target;
    return {
      ...ev,
      target: {
        ...t,
        bbox: { ...t.bbox, x: t.bbox.x + pos.offset.x, y: t.bbox.y + pos.offset.y },
        point: { x: t.point.x + pos.offset.x, y: t.point.y + pos.offset.y },
        frames: pos.frames,
      },
    };
  }

  private async applyEvent(
    ev: CaptureEvent,
    shot: PendingShot | undefined,
  ): Promise<Step | undefined> {
    if (!this.session || !this.guide) return undefined;
    const result = this.session.apply(ev);
    for (const removed of result.removed) await this.deleteStepImages([removed]);
    if (result.wantsShot) await this.attachShot(result.step, shot);
    this.state.stepCount = this.session.count;
    return result.step;
  }

  private async attachShot(step: Step, shot: PendingShot | undefined): Promise<void> {
    if (!this.guide) return;
    if (shot?.kind === 'captured') {
      const encoded = await this.deps.encode(shot.dataUrl);
      const name = `${step.id}.${encoded.ext}`;
      await this.deps.store.putImage(this.guide.id, name, encoded.full);
      await this.deps.store.putImage(
        this.guide.id,
        `${step.id}.thumb.${encoded.ext}`,
        encoded.thumb,
      );
      const scale = shot.viewportWidth > 0 ? encoded.width / shot.viewportWidth : shot.dpr;
      const info: ShotInfo = {
        file: `img/${name}`,
        width: encoded.width,
        height: encoded.height,
        dpr: shot.dpr,
        scale,
      };
      attachScreenshot(step, info, this.deps.maxZoom);
      this.lastShot = { ...info, stepId: step.id };
      if (shot.words) {
        const words = scalePageText(shot.words, scale, encoded.width, encoded.height);
        await this.deps.store.putImage(this.guide.id, wordsFileFor(name), serializePageText(words));
      }
    } else if (!step.human.screenshot && this.lastShot) {
      const { stepId, ...info } = this.lastShot;
      attachScreenshot(step, { ...info, reusedFromStepId: stepId }, this.deps.maxZoom);
    }
  }

  private async deleteStepImages(steps: Step[]): Promise<void> {
    if (!this.guide) return;
    const ids = new Set(steps.map((s) => s.id));
    for (const name of await this.deps.store.listImages(this.guide.id)) {
      const owner = name.split('.')[0] ?? '';
      if (ids.has(owner)) await this.deps.store.deleteImage(this.guide.id, name);
    }
  }

  private async save(snapshot = false): Promise<void> {
    if (!this.guide || !this.session) return;
    const guide = this.session.applyTo(this.guide, this.base);
    const origins = new Set(
      guide.apps.filter((a) => a.kind === 'web').map((a) => (a.kind === 'web' ? a.origin : '')),
    );
    const processes = new Set(
      guide.apps.flatMap((a) => (a.kind === 'desktop' ? [a.processName.toLowerCase()] : [])),
    );
    for (const s of this.session.steps) {
      if (s.app.kind === 'desktop') {
        const name = s.app.processName;
        if (name && !processes.has(name.toLowerCase())) {
          processes.add(name.toLowerCase());
          guide.apps = [...guide.apps, { kind: 'desktop', processName: name }];
        }
        continue;
      }
      const origin = originOf(s.app.url);
      if (origin && !origins.has(origin)) {
        origins.add(origin);
        guide.apps = [...guide.apps, { kind: 'web', origin }];
      }
    }
    // Keep the updated metadata (apps), but the original blocks stay the insertion base.
    this.guide = { ...guide, blocks: this.base };
    await this.deps.store.saveGuide(guide, { snapshot });
    await this.persist();
  }

  private persist(): Promise<void> {
    if (!this.guide || !this.session) return this.deps.persist(null);
    const data: PersistedRecorder = {
      state: this.current,
      guideId: this.guide.id,
      isNew: this.isNew,
      addedStepIds: this.session.steps.map((s) => s.id),
      viewports: [...this.viewports],
      tabs: [...this.tabs],
      frames: this.deps.frames.toJSON(),
    };
    if (this.session.insertAt !== undefined) data.insertAt = this.session.insertAt;
    if (this.lastShot) data.lastShot = this.lastShot;
    return this.deps.persist(data);
  }

  private publish(): void {
    const state = this.current;
    for (const tabId of this.tabs) this.deps.sendState(tabId, state);
    this.deps.broadcastState(state);
  }

  /** Resume a capture after the service worker restarted. */
  restore(data: PersistedRecorder): Promise<void> {
    return this.serial(async () => {
      const guide = await this.deps.store.getGuide(data.guideId);
      if (!guide) {
        await this.deps.persist(null);
        return;
      }
      const added = new Set(data.addedStepIds);
      const steps = guide.blocks.filter((b): b is Step => b.kind === 'step' && added.has(b.id));
      this.guide = guide;
      this.base = guide.blocks.filter((b) => !added.has(b.id));
      this.session = CaptureSession.restore(steps, data.insertAt, guide.settings.defaultInputMode);
      this.isNew = data.isNew;
      this.lastShot = data.lastShot;
      this.state = { ...data.state, stepCount: steps.length };
      for (const [tab, vp] of data.viewports) this.viewports.set(tab, vp);
      for (const tab of data.tabs) this.tabs.add(tab);
      this.deps.frames.load(data.frames);
    });
  }

  /** Guide being recorded, with the session's steps in place (for tests and the side panel). */
  async currentGuide(): Promise<Guide | undefined> {
    return this.guide ? this.deps.store.getGuide(this.guide.id) : undefined;
  }
}

function webApp(url: string, title?: string, frameUrl?: string): AppContext {
  const app: AppContext = { kind: 'web', url };
  if (title) app.title = title;
  if (frameUrl) app.frameUrl = frameUrl;
  return app;
}

function originOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol.startsWith('http') ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
