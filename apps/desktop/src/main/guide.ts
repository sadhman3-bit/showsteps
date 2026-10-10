import { guideSteps, toPlainText, type Guide, type GuideStore, type Step } from '@trailmark/core';
import { EventEmitter } from 'node:events';
import type { HelperEvent, PxRect, UiaElement, UiaHelper } from './helper';

/** What the overlay draws: the target ring (physical pixels) and the step card. */
export interface OverlayView {
  rect?: PxRect;
  number: number;
  total: number;
  title: string;
  /** showing: ring on the target · not-found · web: a browser step to do there. */
  phase: 'showing' | 'not-found' | 'web' | 'done';
  canGoBack: boolean;
}

export interface OverlayHost {
  show(view: OverlayView): void;
  hide(): void;
}

/** Pick the element that best matches a recorded desktop target. */
export function bestMatch(step: Step, matches: UiaElement[]): UiaElement | undefined {
  const uia = step.target?.uia;
  if (!uia || !matches.length) return undefined;
  const pathKey = (uia.path ?? []).join('>');
  const score = (m: UiaElement) =>
    (uia.automationId && m.automationId === uia.automationId ? 4 : 0) +
    (uia.name && m.name === uia.name ? 3 : 0) +
    (uia.controlType && m.controlType === uia.controlType ? 2 : 0) +
    (pathKey && m.path.join('>') === pathKey ? 2 : 0) +
    (uia.windowTitle && m.windowTitle === uia.windowTitle ? 1 : 0);
  return [...matches].sort((a, b) => score(b) - score(a))[0];
}

/** Find a recorded desktop step's element on screen now. */
export async function locate(helper: UiaHelper, step: Step): Promise<UiaElement | undefined> {
  const uia = step.target?.uia;
  if (!uia || step.app.kind !== 'desktop') return undefined;
  const base = { processName: uia.processName ?? step.app.processName };
  const byId = uia.automationId
    ? await helper.find({ ...base, automationId: uia.automationId })
    : [];
  const found = byId.length
    ? byId
    : await helper.find({
        ...base,
        ...(uia.name ? { name: uia.name } : {}),
        ...(uia.controlType ? { controlType: uia.controlType } : {}),
      });
  return bestMatch(step, found);
}

const inside = (r: PxRect, x: number, y: number) =>
  x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;

/**
 * Desktop Guide Me (G8): highlights each desktop step's element with a click-through overlay
 * and moves on when the person clicks inside it (or finishes typing there). Runs a whole
 * desktop guide on its own, or single steps handed over by the extension for mixed guides.
 */
export class DesktopGuide extends EventEmitter<{
  /** A step was done (the extension waits for this for delegated steps). */
  done: [stepId: string];
  state: [state: { active: boolean; guideId?: string; index: number; total: number }];
}> {
  private steps: Step[] = [];
  private index = 0;
  private guideId: string | undefined;
  /** Only this one step (handed over by the extension). */
  private single: Step | undefined;
  private rect: PxRect | undefined;
  private typed = false;
  private seq = 0;

  constructor(
    private readonly helper: UiaHelper,
    private readonly overlay: OverlayHost,
    private readonly hooks: (on: boolean) => Promise<void>,
  ) {
    super();
    helper.on('event', (ev) => this.onInput(ev));
  }

  get active(): boolean {
    return !!this.guideId || !!this.single;
  }

  private current(): Step | undefined {
    return this.single ?? this.steps[this.index];
  }

  private emitState(): void {
    this.emit('state', {
      active: this.active,
      ...(this.guideId ? { guideId: this.guideId } : {}),
      index: this.index,
      total: this.steps.length,
    });
  }

  /** Guide a whole guide here (desktop steps highlighted, web steps shown as a card). */
  async start(store: GuideStore, guideId: string): Promise<void> {
    const guide: Guide | undefined = await store.getGuide(guideId);
    if (!guide) return;
    this.single = undefined;
    this.steps = guideSteps(guide);
    this.index = 0;
    this.guideId = guideId;
    await this.hooks(true);
    this.emitState();
    await this.show();
  }

  /** Show one step for the extension's Guide Me. */
  async showStep(step: Step, number: number, total: number): Promise<void> {
    this.single = step;
    this.steps = [];
    this.index = number - 1;
    await this.hooks(true);
    await this.show(number, total);
  }

  async stop(): Promise<void> {
    this.seq++;
    this.single = undefined;
    this.guideId = undefined;
    this.steps = [];
    this.rect = undefined;
    this.overlay.hide();
    await this.hooks(false);
    this.emitState();
  }

  async control(action: 'next' | 'back' | 'stop'): Promise<void> {
    const step = this.current();
    if (action === 'stop') return this.stop();
    if (action === 'next' && step) return this.complete(step);
    if (action === 'back' && !this.single && this.index > 0) {
      this.index--;
      await this.show();
    }
  }

  private async show(
    number = this.index + 1,
    total = this.single ? number : this.steps.length,
  ): Promise<void> {
    const seq = ++this.seq;
    this.rect = undefined;
    this.typed = false;
    const step = this.current();
    if (!step) {
      this.overlay.show({ number: total, total, title: '', phase: 'done', canGoBack: false });
      this.guideId = undefined;
      await this.hooks(false);
      this.emitState();
      return;
    }
    const title = toPlainText(step.human.title);
    const base = { number, total, title, canGoBack: !this.single && this.index > 0 };
    if (step.app.kind === 'web') {
      this.overlay.show({ ...base, phase: 'web' });
      return;
    }
    // The app may still be opening: keep looking for a few seconds.
    let el: UiaElement | undefined;
    const deadline = Date.now() + Math.min(step.agent.timeoutMs, 8000);
    while (!el && Date.now() < deadline && seq === this.seq) {
      el = await locate(this.helper, step);
      if (!el) await new Promise((r) => setTimeout(r, 400));
    }
    if (seq !== this.seq) return;
    this.rect = el?.rect;
    this.overlay.show({
      ...base,
      phase: el ? 'showing' : 'not-found',
      ...(el ? { rect: el.rect } : {}),
    });
  }

  private async complete(step: Step): Promise<void> {
    this.emit('done', step.id);
    if (this.single) {
      this.single = undefined;
      this.rect = undefined;
      this.overlay.hide();
      await this.hooks(false);
      return;
    }
    this.index++;
    this.emitState();
    await this.show();
  }

  /** Hook input while guiding: a click in the ring, or typing there then moving on. */
  private onInput(ev: HelperEvent): void {
    const step = this.current();
    if (!step || step.app.kind !== 'desktop' || !this.rect) return;
    const rect = this.rect;
    if (ev.event === 'typing') {
      if (step.action === 'type') this.typed = true;
      return;
    }
    if (ev.event === 'key') {
      if (step.action === 'key' && ev.key === step.key) void this.complete(step);
      else if (this.typed && (ev.key === 'Tab' || ev.key === 'Enter')) void this.complete(step);
      return;
    }
    if (step.action === 'type') {
      if (this.typed && !inside(rect, ev.x, ev.y)) void this.complete(step);
      return;
    }
    const wanted = step.action === 'right_click' ? 'right' : 'left';
    if (ev.button === wanted && inside(rect, ev.x, ev.y)) void this.complete(step);
  }
}
