import {
  CaptureSession,
  attachScreenshot,
  createGuide,
  nowIso,
  type CaptureEvent,
  type Guide,
  type GuideStore,
  type Step,
} from '@trailmark/core';
import {
  clickEvent,
  elementKey,
  isBrowser,
  isMultiline,
  isRemote,
  keyEvent,
  typeEvent,
} from './events';
import type { HelperEvent, PxRect, UiaElement, UiaHelper } from './helper';

/** A screenshot ready to store: the full picture (PNG) and a thumbnail. */
export interface DesktopShot {
  full: Uint8Array;
  thumb: Uint8Array;
  width: number;
  height: number;
  /** Monitor scale (DPI / 96). */
  scale: number;
}

/** Where recorded events go: this app's library, or the extension's capture (shared session). */
export interface CaptureSink {
  event(ev: CaptureEvent, shot: DesktopShot | undefined): Promise<void>;
  deleteLast(): Promise<void>;
  finish(): Promise<string | undefined>;
  cancel(): Promise<void>;
  readonly stepCount: number;
}

export interface DesktopCaptureState {
  status: 'idle' | 'recording' | 'paused';
  stepCount: number;
  /** The extension records browser steps into the same guide. */
  shared: boolean;
  lastGuideId?: string;
}

export interface RecorderDeps {
  helper: UiaHelper;
  readShot(path: string, scale: number): Promise<DesktopShot>;
  /** Our own windows: never recorded. */
  ownPids(): number[];
  shotDir: string;
  onState(state: DesktopCaptureState): void;
}

const DOUBLE_CLICK_MS = 500;
const SNAPSHOT_DELAY_MS = 250;
const WATCH_TYPING_MS = 400;

/**
 * Records Windows apps through uia-helper's hooks. Clicks become steps with the picture taken
 * before the click landed; typing is read from the control when it is committed (Enter in a
 * single-line field, Tab, a click elsewhere, finishing), never from password controls.
 */
export class DesktopRecorder {
  private state: DesktopCaptureState = { status: 'idle', stepCount: 0, shared: false };
  private sink: CaptureSink | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private typing: { el: UiaElement | undefined; snapshot: UiaElement | undefined } | undefined;
  private snapshotTimer: NodeJS.Timeout | undefined;
  private lastClick: { key: string; at: number } | undefined;
  private lastMonitor: PxRect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(private readonly deps: RecorderDeps) {
    deps.helper.on('event', (ev) => {
      if (this.state.status !== 'recording') return;
      void this.serial(() => this.onEvent(ev)).catch((error: unknown) =>
        console.error('Trailmark: could not record desktop step', error),
      );
    });
  }

  get current(): DesktopCaptureState {
    return { ...this.state };
  }

  get isActive(): boolean {
    return this.state.status !== 'idle';
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private set(patch: Partial<DesktopCaptureState>): void {
    this.state = { ...this.state, ...patch };
    this.deps.onState(this.current);
  }

  async start(sink: CaptureSink, shared: boolean): Promise<void> {
    if (this.isActive) return;
    this.sink = sink;
    this.typing = undefined;
    this.lastClick = undefined;
    await this.deps.helper.hook(true, { dir: this.deps.shotDir, ignorePids: this.deps.ownPids() });
    this.set({ status: 'recording', stepCount: sink.stepCount, shared });
  }

  pause(): void {
    if (this.state.status === 'recording') this.set({ status: 'paused' });
  }

  resume(): void {
    if (this.state.status === 'paused') this.set({ status: 'recording' });
  }

  deleteLast(): Promise<void> {
    return this.serial(async () => {
      await this.sink?.deleteLast();
      this.set({ stepCount: this.sink?.stepCount ?? 0 });
    });
  }

  finish(): Promise<string | undefined> {
    return this.serial(async () => {
      await this.commitTyping();
      await this.deps.helper.hook(false).catch(() => undefined);
      const id = await this.sink?.finish();
      this.sink = undefined;
      this.set({ status: 'idle', stepCount: 0, shared: false, ...(id ? { lastGuideId: id } : {}) });
      return id;
    });
  }

  cancel(): Promise<void> {
    return this.serial(async () => {
      await this.deps.helper.hook(false).catch(() => undefined);
      await this.sink?.cancel();
      this.sink = undefined;
      this.typing = undefined;
      this.set({ status: 'idle', stepCount: 0, shared: false });
    });
  }

  // ---------- Events ----------

  /** Our own windows, and browsers while the extension records them (with far better detail). */
  private skip(el: { processName: string; pid: number }): boolean {
    if (this.deps.ownPids().includes(el.pid)) return true;
    return this.state.shared && isBrowser(el.processName);
  }

  private async onEvent(ev: HelperEvent): Promise<void> {
    if (ev.event === 'typing') {
      await this.noteTyping();
      return;
    }
    if (ev.event === 'foreground') {
      // Switching to another app (the browser, say) ends typing in this one, so it keeps its
      // place before whatever happens next.
      if (this.typing?.el && this.typing.el.pid !== ev.pid) await this.commitTyping();
      return;
    }
    if (ev.event === 'key') {
      const el = this.typing?.snapshot ?? this.typing?.el ?? (await this.deps.helper.focused());
      if (el && this.skip(el)) return;
      // Enter in a multi-line control is a new line, part of the typing.
      if (ev.key === 'Enter' && this.typing && el && isMultiline(el)) return;
      const wasTyping = !!this.typing;
      await this.commitTyping();
      // Moving on from a field with Tab is implied by typing into it.
      if (ev.key === 'Tab' && wasTyping) return;
      await this.emit(keyEvent(ev.key, el, this.lastMonitor, ev.at), undefined);
      return;
    }
    // Mouse press.
    if (this.skip(ev.window)) {
      if (this.typing?.el && isBrowser(this.typing.el.processName)) this.typing = undefined;
      return;
    }
    await this.commitTyping();
    this.lastMonitor = ev.monitor;
    const el: UiaElement = ev.element ?? {
      name: '',
      controlType: 'Pane',
      automationId: '',
      className: '',
      rect: { x: ev.x - 20, y: ev.y - 20, w: 40, h: 40 },
      isPassword: false,
      isEnabled: true,
      pid: ev.window.pid,
      processName: ev.window.processName,
      windowTitle: ev.window.windowTitle,
      path: [],
    };
    const shot = await this.deps.readShot(ev.shot, ev.scale).catch(() => undefined);
    const key = elementKey(el);
    const at = Date.parse(ev.at);
    const double =
      ev.button === 'left' &&
      this.lastClick?.key === key &&
      at - this.lastClick.at < DOUBLE_CLICK_MS;
    this.lastClick = { key, at };
    const click = clickEvent(el, ev.button, ev.monitor, { x: ev.x, y: ev.y }, ev.at);
    if (double && click.kind === 'click') {
      const { button: _b, toggle: _t, ...rest } = click;
      await this.emit({ ...rest, kind: 'dblclick' }, undefined);
      this.lastClick = undefined;
      return;
    }
    await this.emit(click, shot);
  }

  private async emit(ev: CaptureEvent, shot: DesktopShot | undefined): Promise<void> {
    if (!this.sink) return;
    await this.sink.event(ev, shot);
    this.set({ stepCount: this.sink.stepCount });
  }

  /** Remember what is being typed into; its value is read again shortly after typing stops. */
  private async noteTyping(): Promise<void> {
    if (!this.typing) {
      const el = await this.deps.helper.focused();
      if (!el || this.skip(el)) return;
      this.typing = { el, snapshot: el };
    }
    this.watchTyping(SNAPSHOT_DELAY_MS);
  }

  /**
   * While typing is pending, look at what has focus now and then: the same control refreshes
   * the value; another app means the person moved on (a backup for the foreground event, which
   * Windows does not always send).
   */
  private watchTyping(delay: number): void {
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => {
      void this.serial(async () => {
        const typing = this.typing;
        if (!typing?.el) return;
        const now = await this.deps.helper.focused();
        if (this.typing !== typing) return;
        if (now && elementKey(now) === elementKey(typing.el)) typing.snapshot = now;
        else if (now && now.pid !== typing.el.pid) {
          await this.commitTyping();
          return;
        }
        this.watchTyping(WATCH_TYPING_MS);
      });
    }, delay);
  }

  private async commitTyping(): Promise<void> {
    const typing = this.typing;
    this.typing = undefined;
    clearTimeout(this.snapshotTimer);
    if (!typing?.el) return;
    const now = await this.deps.helper.focused();
    const el =
      now && elementKey(now) === elementKey(typing.el) ? now : (typing.snapshot ?? typing.el);
    await this.emit(
      typeEvent(el, this.lastMonitor.w ? this.lastMonitor : el.rect, nowIso()),
      undefined,
    );
  }
}

/** Records into a guide in this app's library (no extension involved). */
export class LibrarySink implements CaptureSink {
  private readonly session = new CaptureSession();
  private guide: Guide;
  private lastShot:
    { file: string; width: number; height: number; dpr: number; stepId: string } | undefined;

  constructor(
    private readonly store: GuideStore,
    title: string,
  ) {
    this.guide = createGuide({ title });
  }

  get stepCount(): number {
    return this.session.count;
  }

  get guideId(): string {
    return this.guide.id;
  }

  async event(ev: CaptureEvent, shot: DesktopShot | undefined): Promise<void> {
    const result = this.session.apply(ev);
    for (const removed of result.removed) await this.deleteImages(removed);
    const step = result.step;
    if (step.app.kind === 'desktop' && isRemote(step.app.processName)) step.agent.visualOnly = true;
    if (result.wantsShot) {
      if (shot) {
        const name = `${step.id}.png`;
        await this.store.putImage(this.guide.id, name, shot.full);
        await this.store.putImage(this.guide.id, `${step.id}.thumb.png`, shot.thumb);
        const info = {
          file: `img/${name}`,
          width: shot.width,
          height: shot.height,
          dpr: shot.scale,
        };
        attachScreenshot(step, { ...info, scale: 1 });
        this.lastShot = { ...info, stepId: step.id };
      } else if (!step.human.screenshot && this.lastShot) {
        const { stepId, ...info } = this.lastShot;
        attachScreenshot(step, { ...info, scale: 1, reusedFromStepId: stepId });
      }
    }
    await this.save();
  }

  private async deleteImages(step: Step): Promise<void> {
    for (const name of await this.store.listImages(this.guide.id)) {
      if (name.startsWith(`${step.id}.`)) await this.store.deleteImage(this.guide.id, name);
    }
  }

  private async save(): Promise<void> {
    const guide = this.session.applyTo(this.guide, []);
    const processes = new Set(
      guide.apps.flatMap((a) => (a.kind === 'desktop' ? [a.processName.toLowerCase()] : [])),
    );
    for (const s of this.session.steps) {
      if (
        s.app.kind === 'desktop' &&
        s.app.processName &&
        !processes.has(s.app.processName.toLowerCase())
      ) {
        processes.add(s.app.processName.toLowerCase());
        guide.apps = [...guide.apps, { kind: 'desktop', processName: s.app.processName }];
      }
    }
    this.guide = { ...guide, blocks: [] };
    await this.store.saveGuide(guide, { snapshot: false });
  }

  async deleteLast(): Promise<void> {
    const step = this.session.deleteLast();
    if (step) await this.deleteImages(step);
    await this.save();
  }

  async finish(): Promise<string | undefined> {
    if (!this.session.count) {
      await this.store.purgeGuide(this.guide.id).catch(() => undefined);
      return undefined;
    }
    await this.store.saveGuide(this.session.applyTo(this.guide, []), { snapshot: true });
    return this.guide.id;
  }

  async cancel(): Promise<void> {
    await this.store.purgeGuide(this.guide.id).catch(() => undefined);
  }
}
