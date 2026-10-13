import { strings } from '@showsteps/ui/strings';
import type { CaptureState, ControlAction } from '../messages';

const s = strings.capture;

// Self-contained styles: the page's CSS cannot reach into the shadow root and ours cannot leak out.
const CSS = `
:host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  --bg: #1b1a18; --fg: #f2eee8; --muted: #b5ada1; --line: #3d3933; --accent: #4fbfb2;
  --on-accent: #0b1513; --rec: #f87171; --focus: #fb923c; }
.bar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 12px;
  background: var(--bg); color: var(--fg); border: 1px solid var(--line);
  box-shadow: 0 6px 24px rgb(0 0 0 / 0.35); font: 13px/1.2 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
  user-select: none; }
.grip { cursor: grab; padding: 4px 2px; color: var(--muted); touch-action: none; }
.grip:active { cursor: grabbing; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--rec); }
.paused .dot { background: var(--muted); }
.status { font-weight: 600; }
.count { color: var(--muted); min-width: 4.5em; }
button { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line);
  border-radius: 8px; padding: 5px 9px; cursor: pointer; }
button:hover { background: #2a2723; }
button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
button[aria-pressed='true'] { background: #2f3f3c; border-color: var(--accent); color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
button.danger { border-color: var(--rec); color: var(--rec); }
.above { position: absolute; right: 0; bottom: calc(100% + 6px); display: flex; flex-direction: column;
  align-items: flex-end; gap: 6px; pointer-events: none; }
.hint, .toast { background: var(--bg); color: var(--fg); border: 1px solid var(--accent); border-radius: 8px;
  padding: 6px 10px; font-size: 12px; }
.hint { white-space: nowrap; }
.toast { display: flex; align-items: center; gap: 8px; max-width: 340px; border-color: var(--line);
  box-shadow: 0 6px 24px rgb(0 0 0 / 0.35); transition: opacity 0.2s; }
.toast[hidden] { display: none; }
.toast .num { display: grid; place-items: center; flex: none; min-width: 20px; height: 20px; border-radius: 10px;
  background: var(--accent); color: var(--on-accent); font-weight: 700; font-size: 11px; padding: 0 4px; }
.toast .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
.main { display: contents; }
.confirm { display: none; }
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
      <span class="grip" title="${s.drag}" aria-hidden="true">⋮⋮</span>
      <span class="main">
        <span class="dot" aria-hidden="true"></span>
        <span class="status" data-el="status" role="status"></span>
        <span class="count" data-el="count"></span>
        <button type="button" data-act="pause" data-el="pause"></button>
        <button type="button" data-act="delete-last">${s.deleteLast}</button>
        <button type="button" data-act="toggle-live-blur" data-el="blur">${s.liveBlur}</button>
        <button type="button" class="primary" data-act="finish">${s.finish}</button>
        <button type="button" data-act="ask-cancel">${s.cancel}</button>
      </span>
      <span class="confirm">
        <span>${s.cancelConfirm}</span>
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
      pause.textContent = paused ? s.resume : s.pause;
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
    this.toastTimer = setTimeout(() => (toast.hidden = true), 3000);
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
