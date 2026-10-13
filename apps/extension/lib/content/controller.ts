import { iconSvg } from '@showsteps/ui/icons';
import { strings } from '@showsteps/ui/strings';
import { CHROME_BASE_CSS } from './chromeStyle';
import type { CaptureState, ControlAction } from '../messages';

const s = strings.capture;

// Self-contained styles: the page's CSS cannot reach into the shadow root and ours cannot leak out.
const CSS = `${CHROME_BASE_CSS}
:host { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
.bar { display: flex; align-items: center; gap: 4px; height: 56px; padding: 0 6px 0 4px;
  border-radius: 999px; background: var(--ss-chrome-bg); border: 1px solid var(--ss-chrome-line);
  box-shadow: var(--ss-chrome-shadow); user-select: none; }
.grip { display: grid; place-items: center; width: 24px; height: 44px; cursor: grab;
  color: var(--ss-chrome-muted); touch-action: none; border-radius: 999px; }
.grip:active { cursor: grabbing; }
.lead { display: flex; align-items: center; gap: 8px; padding: 0 8px 0 2px; white-space: nowrap; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--ss-chrome-signal); }
/* A steady dot: any animation here keeps the recorded page busy, and screenshots and clicks
   then come late (seen in e2e). The side panel's dot pulses instead. */
.paused .dot { background: var(--ss-chrome-muted); }
.status { font-weight: 700; }
.count { color: var(--ss-chrome-muted); min-width: 4.5em; font-variant-numeric: tabular-nums; }
.sep { width: 1px; height: 24px; margin: 0 4px; background: var(--ss-chrome-line); }
button { display: inline-flex; align-items: center; gap: 6px; height: 44px; padding: 0 14px;
  font: inherit; font-weight: 600; color: var(--ss-chrome-fg); background: transparent; border: 0;
  border-radius: 999px; cursor: pointer; white-space: nowrap;
  transition: background-color 120ms cubic-bezier(.2,.8,.2,1); }
button:hover { background: var(--ss-chrome-button); }
button:focus-visible { outline: 2px solid var(--ss-chrome-signal); outline-offset: 2px; }
button.icon-only { width: 44px; padding: 0; justify-content: center; }
button[aria-pressed='true'] { background: var(--ss-chrome-button); color: var(--ss-chrome-step); }
button.signal { background: var(--ss-chrome-signal); color: var(--ss-chrome-on-signal); padding: 0 18px; }
button.signal:hover { background: var(--ss-chrome-step); }
button.danger { color: var(--ss-chrome-step); }
.above { position: absolute; right: 0; bottom: calc(100% + 8px); display: flex; flex-direction: column;
  align-items: flex-end; gap: 8px; pointer-events: none; }
.hint, .toast { background: var(--ss-chrome-bg); color: var(--ss-chrome-fg); border: 1px solid var(--ss-chrome-line);
  border-radius: 999px; box-shadow: var(--ss-chrome-shadow); }
.hint { padding: 8px 14px; font-size: 13px; white-space: nowrap; }
.toast { display: flex; align-items: center; gap: 10px; max-width: 380px; padding: 6px 16px 6px 6px;
  font-weight: 600; }
.toast .num { display: grid; place-items: center; flex: none; min-width: 28px; height: 28px; padding: 0 6px;
  border-radius: 999px; background: var(--ss-chrome-signal); color: var(--ss-chrome-on-signal);
  font-weight: 800; font-size: 15px; font-variant-numeric: tabular-nums; }
.toast .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.main { display: contents; }
.confirm { display: none; }
.confirm .msg { padding: 0 8px 0 4px; max-width: 280px; white-space: normal; font-size: 13px; line-height: 17px; }
.confirming .main { display: none; }
.confirming .confirm { display: contents; }
`;

/** The on-page capture toolbar (top frame only). Hidden from screenshots by the background. */
export class Controller {
  private dialogs: MutationObserver | undefined;
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly bar: HTMLElement;
  private readonly els: Record<string, HTMLElement> = {};
  /** Pictures asked for and not yet taken (see `hideFor`). */
  private holds = 0;
  private hiddenSince = 0;
  private showTimer: ReturnType<typeof setTimeout> | undefined;
  /** The newest step shown in the "just recorded" note, and when the note goes away. */
  private lastSeen: string | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly onAction: (action: ControlAction) => void) {
    this.host = document.createElement('showsteps-controller');
    // Open so tests can reach it; page code has no reason to touch it.
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.bar = document.createElement('div');
    this.bar.className = 'bar';
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', s.controllerLabel);
    this.bar.innerHTML = `
      <span class="grip" title="${s.drag}" aria-hidden="true">${iconSvg('drag', 18)}</span>
      <span class="main">
        <span class="lead">
          <span class="dot" aria-hidden="true"></span>
          <span class="status" data-el="status" role="status"></span>
          <span class="count" data-el="count"></span>
        </span>
        <button type="button" class="icon-only" data-act="pause" data-el="pause"></button>
        <button type="button" data-act="delete-last">${iconSvg('undo', 18)}${s.deleteLast}</button>
        <button type="button" data-act="toggle-live-blur" data-el="blur">${iconSvg('blur', 18)}${s.liveBlur}</button>
        <button type="button" class="signal" data-act="finish">${iconSvg('finish', 18)}${s.finish}</button>
        <span class="sep" aria-hidden="true"></span>
        <button type="button" class="icon-only" data-act="ask-cancel" aria-label="${s.cancelRecording}" title="${s.cancelRecording}">${iconSvg('x', 18)}</button>
      </span>
      <span class="confirm">
        <span class="msg">${s.cancelConfirm}</span>
        <button type="button" class="danger" data-act="cancel">${s.cancel}</button>
        <button type="button" data-act="keep">${s.resume}</button>
      </span>
      <span class="above">
        <span class="toast" data-el="toast" role="status" hidden>
          <span class="num" data-el="toastNum"></span><span class="text" data-el="toastText"></span>
        </span>
        <span class="hint" data-el="hint" hidden>${s.liveBlurOn}</span>
      </span>`;
    for (const el of Array.from(this.bar.querySelectorAll<HTMLElement>('[data-el]'))) {
      this.els[el.dataset.el ?? ''] = el;
    }
    this.root.append(style, this.bar);
    this.bar.addEventListener('click', (e) => this.onClick(e));
    this.enableDrag();
  }

  private onClick(e: Event) {
    const button = (e.target as Element).closest<HTMLElement>('button[data-act]');
    if (!button) return;
    const act = button.dataset.act;
    if (act === 'ask-cancel') this.bar.classList.add('confirming');
    else if (act === 'keep') this.bar.classList.remove('confirming');
    else if (act === 'pause' || act === 'resume') this.onAction(act);
    else this.onAction(act as ControlAction);
  }

  private enableDrag() {
    const grip = this.bar.querySelector<HTMLElement>('.grip');
    if (!grip) return;
    grip.addEventListener('pointerdown', (down) => {
      down.preventDefault();
      grip.setPointerCapture(down.pointerId);
      const start = this.host.getBoundingClientRect();
      const move = (e: PointerEvent) => {
        const right = Math.max(0, innerWidth - (start.right + e.clientX - down.clientX));
        const bottom = Math.max(0, innerHeight - (start.bottom + e.clientY - down.clientY));
        this.host.style.right = `${Math.min(right, innerWidth - 40)}px`;
        this.host.style.bottom = `${Math.min(bottom, innerHeight - 40)}px`;
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
  }

  /**
   * Attach to the page. A modal <dialog> makes everything outside it inert, so while one is
   * open the toolbar moves inside the topmost one (and back out when it closes).
   */
  mount(): void {
    const modal = Array.from(document.querySelectorAll('dialog'))
      .filter((d) => d.matches(':modal'))
      .at(-1);
    const parent = modal ?? document.documentElement;
    if (this.host.parentElement !== parent) parent.append(this.host);
    if (!this.dialogs) {
      this.dialogs = new MutationObserver(() => this.mount());
      this.dialogs.observe(document.documentElement, {
        subtree: true,
        attributes: true,
        attributeFilter: ['open'],
      });
    }
  }

  unmount(): void {
    this.dialogs?.disconnect();
    this.dialogs = undefined;
    this.host.remove();
  }

  update(state: CaptureState): void {
    const paused = state.status === 'paused';
    this.bar.classList.toggle('paused', paused);
    const { status, count, pause, blur, hint } = this.els;
    if (status) status.textContent = paused ? s.paused : s.recording;
    if (count) count.textContent = s.steps(state.stepCount);
    if (pause) {
      const label = paused ? s.resume : s.pause;
      pause.innerHTML = iconSvg(paused ? 'play' : 'pause', 18);
      pause.setAttribute('aria-label', label);
      pause.title = label;
      pause.dataset.act = paused ? 'resume' : 'pause';
    }
    blur?.setAttribute('aria-pressed', String(state.liveBlur));
    if (hint) hint.hidden = !state.liveBlur;
    this.noteStep(state);
  }

  /** Briefly show the step just recorded (or retitled, as typing goes on) above the toolbar. */
  private noteStep(state: CaptureState): void {
    const { toast, toastNum, toastText } = this.els;
    const last = state.lastStep;
    const seen = last ? `${last.id}|${last.title}` : undefined;
    // The first state a page sees describes steps from before it loaded: no note for those.
    const before = this.lastSeen;
    this.lastSeen = seen ?? '';
    if (!toast || !toastNum || !toastText || before === undefined || !last || seen === before) {
      if (!last && toast) toast.hidden = true;
      return;
    }
    toastNum.textContent = String(last.number);
    toastText.textContent = last.title;
    toast.title = s.justRecorded(last.number, last.title);
    toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (toast.hidden = true), 1500);
  }

  /**
   * Hide for a screenshot. Each call is matched by one `release` when that picture is taken;
   * the toolbar comes back once no picture is pending (or after `ms` as a safety net). Resolves
   * at once if it has already been hidden for a frame, otherwise after the next paint.
   */
  hideFor(ms = 5000): Promise<void> {
    this.holds++;
    const alreadyPainted = this.hiddenSince > 0 && performance.now() - this.hiddenSince > 20;
    if (!this.hiddenSince) this.hiddenSince = performance.now();
    this.host.style.visibility = 'hidden';
    clearTimeout(this.showTimer);
    this.showTimer = setTimeout(() => this.show(), ms);
    if (alreadyPainted) return Promise.resolve();
    // Two frames: the hidden toolbar has then been composited even on a busy machine.
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))),
    );
  }

  /** One picture is taken: show the toolbar again if no other is pending. */
  release(): void {
    this.holds = Math.max(0, this.holds - 1);
    if (!this.holds) this.show();
  }

  show(): void {
    clearTimeout(this.showTimer);
    this.holds = 0;
    this.hiddenSince = 0;
    this.host.style.visibility = '';
  }

  contains(path: EventTarget[]): boolean {
    return path.includes(this.host);
  }
}
