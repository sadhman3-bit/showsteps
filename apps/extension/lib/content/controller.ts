import { strings } from '@trailmark/ui/strings';
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
.hint { position: absolute; right: 0; bottom: calc(100% + 6px); background: var(--bg); color: var(--fg);
  border: 1px solid var(--accent); border-radius: 8px; padding: 6px 10px; white-space: nowrap; font-size: 12px; }
.main { display: contents; }
.confirm { display: none; }
.confirming .main { display: none; }
.confirming .confirm { display: contents; }
`;

/** The on-page capture toolbar (top frame only). Hidden from screenshots by the background. */
export class Controller {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly bar: HTMLElement;
  private readonly els: Record<string, HTMLElement> = {};
  private hiddenSince = 0;
  private showTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly onAction: (action: ControlAction) => void) {
    this.host = document.createElement('trailmark-controller');
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
      <span class="hint" data-el="hint" hidden>${s.liveBlurOn}</span>`;
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

  mount(): void {
    if (!this.host.isConnected) document.documentElement.append(this.host);
  }

  unmount(): void {
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
  }

  /**
   * Hide for a screenshot (re-shown by `show` or after `ms` as a safety net). Resolves at once
   * if it has already been hidden for a frame, otherwise after the next paint.
   */
  hideFor(ms = 1500): Promise<void> {
    const alreadyPainted = this.hiddenSince > 0 && performance.now() - this.hiddenSince > 20;
    if (!this.hiddenSince) this.hiddenSince = performance.now();
    this.host.style.visibility = 'hidden';
    clearTimeout(this.showTimer);
    this.showTimer = setTimeout(() => this.show(), ms);
    if (alreadyPainted) return Promise.resolve();
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  show(): void {
    clearTimeout(this.showTimer);
    this.hiddenSince = 0;
    this.host.style.visibility = '';
  }

  contains(path: EventTarget[]): boolean {
    return path.includes(this.host);
  }
}
