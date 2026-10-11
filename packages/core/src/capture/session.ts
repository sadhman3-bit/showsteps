import { needsConfirm } from '../agent/confirm.js';
import { createStep } from '../factory.js';
import { actionBoxFor, autoCrop } from '../geometry.js';
import type { AppContext, Guide, InputMode, Step, Target } from '../schema.js';
import { writeStepTitle } from '../stepText.js';

/** Identity of the element an event happened on, stable within one page (frame token + counter). */
export type ElementKey = string;

interface Base {
  app: AppContext;
  at: string;
  source?: Step['capture']['source'];
  tabId?: number;
}

/** Events produced by a recorder (extension content script or desktop hooks). */
export type CaptureEvent =
  | (Base & {
      kind: 'click';
      button: 'left' | 'right';
      target: Target;
      element: ElementKey;
      /** For checkboxes and radios: the state after this click. */
      toggle?: { role: 'checkbox' | 'radio'; checked: boolean };
    })
  | (Base & { kind: 'dblclick'; target: Target; element: ElementKey })
  | (Base & {
      kind: 'type';
      target: Target;
      element: ElementKey;
      value?: string;
      sensitive: boolean;
    })
  | (Base & { kind: 'select'; target: Target; element: ElementKey; value: string })
  | (Base & {
      kind: 'check';
      target: Target;
      element: ElementKey;
      checked: boolean;
      role: 'checkbox' | 'radio';
    })
  | (Base & { kind: 'upload'; target: Target; element: ElementKey; files: string[] })
  | (Base & { kind: 'key'; key: string; target?: Target; element?: ElementKey })
  | (Base & { kind: 'navigate' });

export interface ApplyResult {
  step: Step;
  /** "added": new step; "updated": an earlier step changed (merge); */
  change: 'added' | 'updated';
  /** Steps removed by this event (e.g. the second click of a double-click). */
  removed: Step[];
  /** Whether a screenshot taken for this event should be attached to `step`. */
  wantsShot: boolean;
}

/** Decides how recorded events become steps. Holds only the steps added in this session. */
export class CaptureSession {
  private readonly added: Step[] = [];
  private readonly keys = new Map<string, ElementKey | undefined>();

  constructor(
    /** Index in the guide's blocks where new steps go (end of guide if omitted). */
    readonly insertAt?: number,
    /** How new typed values are used (U4): the guide's default. */
    readonly defaultInputMode: InputMode = 'fixed',
  ) {}

  /**
   * Rebuild a session from steps saved earlier (the background worker can be stopped by the
   * browser mid-recording). Element identities are not restored, so the next event never merges
   * into a restored step.
   */
  static restore(
    steps: readonly Step[],
    insertAt?: number,
    defaultInputMode: InputMode = 'fixed',
  ): CaptureSession {
    const session = new CaptureSession(insertAt, defaultInputMode);
    for (const step of steps) {
      session.added.push(step);
      session.keys.set(step.id, undefined);
    }
    return session;
  }

  get steps(): readonly Step[] {
    return this.added;
  }

  get count(): number {
    return this.added.length;
  }

  private last(): Step | undefined {
    return this.added[this.added.length - 1];
  }

  private lastOn(element: ElementKey | undefined): Step | undefined {
    const last = this.last();
    return last && element && this.keys.get(last.id) === element ? last : undefined;
  }

  private add(step: Step, element: ElementKey | undefined): ApplyResult {
    // U5: a control whose name means something irreversible asks before it is done.
    if (needsConfirm(step)) step.agent.confirm = true;
    step.human.title = writeStepTitle(step);
    this.added.push(step);
    this.keys.set(step.id, element);
    return { step, change: 'added', removed: [], wantsShot: true };
  }

  private update(step: Step, wantsShot: boolean): ApplyResult {
    step.human.title = writeStepTitle(step);
    return { step, change: 'updated', removed: [], wantsShot };
  }

  private newStep(ev: Base, init: Omit<Parameters<typeof createStep>[0], 'app'>): Step {
    return createStep({
      ...init,
      app: ev.app,
      capture: {
        at: ev.at,
        source: ev.source ?? 'extension',
        ...(ev.tabId !== undefined ? { tabId: ev.tabId } : {}),
      },
    });
  }

  apply(ev: CaptureEvent): ApplyResult {
    switch (ev.kind) {
      case 'click': {
        if (ev.button === 'right') {
          return this.add(
            this.newStep(ev, { action: 'right_click', target: ev.target }),
            ev.element,
          );
        }
        if (ev.toggle) {
          const prev = this.lastOn(ev.element);
          if (prev?.action === 'check') {
            prev.input = toggleInput(ev.toggle.checked);
            return this.update(prev, false);
          }
          return this.add(
            this.newStep(ev, {
              action: 'check',
              target: { ...ev.target, role: ev.toggle.role },
              input: toggleInput(ev.toggle.checked),
            }),
            ev.element,
          );
        }
        return this.add(this.newStep(ev, { action: 'click', target: ev.target }), ev.element);
      }

      case 'dblclick': {
        const last = this.lastOn(ev.element);
        if (last && (last.action === 'click' || last.action === 'double_click')) {
          const removed: Step[] = [];
          const before = this.added[this.added.length - 2];
          if (
            last.action === 'click' &&
            before?.action === 'click' &&
            this.keys.get(before.id) === ev.element
          ) {
            // The browser reported both clicks of the double-click: keep the first.
            this.added.pop();
            this.keys.delete(last.id);
            removed.push(last);
            before.action = 'double_click';
            return { ...this.update(before, false), removed };
          }
          last.action = 'double_click';
          return this.update(last, false);
        }
        return this.add(
          this.newStep(ev, { action: 'double_click', target: ev.target }),
          ev.element,
        );
      }

      case 'type': {
        const input = ev.sensitive
          ? { mode: 'fixed' as const, sensitive: true }
          : {
              mode: this.defaultInputMode,
              sensitive: false,
              ...(ev.value !== undefined ? { value: ev.value } : {}),
            };
        const prev = this.lastOn(ev.element);
        if (prev && (prev.action === 'click' || prev.action === 'type')) {
          prev.action = 'type';
          prev.target = ev.target;
          prev.input = input;
          return this.update(prev, true);
        }
        return this.add(this.newStep(ev, { action: 'type', target: ev.target, input }), ev.element);
      }

      case 'select': {
        const input = { mode: 'fixed' as const, sensitive: false, value: ev.value };
        const prev = this.lastOn(ev.element);
        if (prev && (prev.action === 'click' || prev.action === 'select')) {
          prev.action = 'select';
          prev.input = input;
          return this.update(prev, false);
        }
        return this.add(
          this.newStep(ev, { action: 'select', target: ev.target, input }),
          ev.element,
        );
      }

      case 'check': {
        const prev = this.lastOn(ev.element);
        if (prev && (prev.action === 'check' || prev.action === 'click')) {
          prev.action = 'check';
          prev.target = { ...(prev.target ?? ev.target), role: ev.role };
          prev.input = toggleInput(ev.checked);
          return this.update(prev, false);
        }
        return this.add(
          this.newStep(ev, {
            action: 'check',
            target: { ...ev.target, role: ev.role },
            input: toggleInput(ev.checked),
          }),
          ev.element,
        );
      }

      case 'upload': {
        const value = ev.files.join(', ');
        const input = { mode: 'fixed' as const, sensitive: false, value };
        const prev = this.lastOn(ev.element);
        if (prev && (prev.action === 'click' || prev.action === 'upload')) {
          prev.action = 'upload';
          prev.input = input;
          return this.update(prev, false);
        }
        return this.add(
          this.newStep(ev, { action: 'upload', target: ev.target, input }),
          ev.element,
        );
      }

      case 'key':
        return this.add(
          this.newStep(ev, {
            action: 'key',
            key: ev.key,
            ...(ev.target ? { target: ev.target } : {}),
          }),
          ev.element,
        );

      case 'navigate':
        return this.add(this.newStep(ev, { action: 'navigate' }), undefined);
    }
  }

  /** Remove the most recent step (Delete last step in the controller). */
  deleteLast(): Step | undefined {
    const step = this.added.pop();
    if (step) this.keys.delete(step.id);
    return step;
  }

  /** Remove one step (the side panel's step list while recording). */
  remove(id: string): Step | undefined {
    const at = this.added.findIndex((s) => s.id === id);
    if (at < 0) return undefined;
    const [step] = this.added.splice(at, 1);
    this.keys.delete(id);
    return step;
  }

  /** Remove every added step (Cancel). */
  clear(): Step[] {
    const all = this.added.splice(0);
    this.keys.clear();
    return all;
  }

  /** The guide with this session's steps inserted at `insertAt`. */
  applyTo(guide: Guide, base: Guide['blocks']): Guide {
    const at =
      this.insertAt === undefined ? base.length : Math.min(Math.max(this.insertAt, 0), base.length);
    return { ...guide, blocks: [...base.slice(0, at), ...this.added, ...base.slice(at)] };
  }
}

function toggleInput(checked: boolean): Step['input'] {
  return { mode: 'fixed', sensitive: false, value: String(checked) };
}

export interface ShotInfo {
  /** Image file path relative to the guide folder, e.g. img/<stepId>.webp. */
  file: string;
  width: number;
  height: number;
  /** Device pixel ratio of the captured page (includes browser zoom). */
  dpr: number;
  /** Image pixels per top-frame CSS pixel. */
  scale: number;
  reusedFromStepId?: string;
}

/**
 * Attach a screenshot to a step: records the file, computes the Action Box from the target's
 * bounding box and an auto-crop that magnifies the area around it.
 */
export function attachScreenshot(step: Step, shot: ShotInfo, maxZoom = 2): void {
  const screenshot: NonNullable<Step['human']['screenshot']> = {
    file: shot.file,
    width: shot.width,
    height: shot.height,
    dpr: shot.dpr,
  };
  if (shot.reusedFromStepId) screenshot.reusedFromStepId = shot.reusedFromStepId;
  if (step.target && (step.target.bbox.w > 0 || step.target.bbox.h > 0)) {
    const box = actionBoxFor(step.target.bbox, shot.scale, shot.width, shot.height);
    if (box.w > 0 && box.h > 0) {
      step.human.actionBox = box;
      const { crop, zoom } = autoCrop(box, shot.width, shot.height, maxZoom);
      if (zoom > 1) {
        screenshot.crop = crop;
        screenshot.zoom = zoom;
      }
    }
  }
  step.human.screenshot = screenshot;
}
