import {
  canPerform,
  describeElement,
  failedExpectations,
  pageKey,
  performStep,
  toActionable,
  waitForTarget,
  type PageMark,
  type RichText,
  type Step,
} from '@trailmark/core';
import { strings } from '@trailmark/ui/strings';
import {
  GuideToContentSchema,
  type GuideContentMessage,
  type GuideControl,
  type GuideToContent,
  type ProbeReply,
  type Speed,
} from '../guideMessages';

const g = strings.guidance;
const m = strings.marks;

const CURSOR_MS: Record<Speed, number> = { slow: 900, normal: 450, fast: 150 };

function send(msg: GuideContentMessage): Promise<unknown> {
  return browser.runtime.sendMessage(msg).catch(() => undefined);
}

/** Visible on screen: has boxes and is not visibility:hidden. */
function isVisible(el: Element): boolean {
  if (!el.getClientRects().length) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

const CSS = `
:host { all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;
  font: 14px/1.4 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
  --bg: #1b1a18; --fg: #f2eee8; --muted: #b5ada1; --line: #3d3933; --accent: #4fbfb2;
  --on-accent: #0b1513; --ring: #fb923c; --tip: #4ade80; --warning: #fbbf24; --link: #93c5fd; }
[hidden] { display: none !important; }
.ring { position: fixed; border: 3px solid var(--ring); border-radius: 8px;
  box-shadow: 0 0 0 4px rgb(251 146 60 / 0.3), 0 0 0 100vmax rgb(0 0 0 / 0.28);
  transition: all 120ms ease-out; }
.tip { position: fixed; max-width: 340px; min-width: 220px; pointer-events: auto; background: var(--bg);
  color: var(--fg); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px;
  box-shadow: 0 8px 28px rgb(0 0 0 / 0.4); }
.count { color: var(--muted); font-size: 12px; margin: 0 0 4px; }
.title { margin: 0 0 6px; font-size: 15px; }
.title strong { color: var(--accent); }
.note { margin: 0 0 8px; color: var(--muted); font-size: 13px; }
.row { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
button { font: inherit; font-size: 13px; color: var(--fg); background: transparent; border: 1px solid var(--line);
  border-radius: 8px; padding: 5px 10px; cursor: pointer; }
button:hover { background: #2a2723; }
button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
.x { position: absolute; top: 6px; right: 6px; border: 0; padding: 2px 7px; color: var(--muted); }
.cursor { position: fixed; width: 22px; height: 22px; margin: -3px 0 0 -3px; transition-property: left, top;
  transition-timing-function: ease-in-out; filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.5)); }
.cursor::after { content: ''; position: absolute; inset: 0; clip-path: polygon(0 0, 0 80%, 25% 60%, 45% 100%, 58% 94%, 40% 56%, 72% 56%);
  background: #fff; outline: none; }
.cursor.clicking::before { content: ''; position: absolute; left: -14px; top: -14px; width: 30px; height: 30px;
  border-radius: 50%; border: 3px solid var(--ring); animation: ripple 400ms ease-out forwards; }
@keyframes ripple { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
.badge { position: fixed; width: 22px; height: 22px; padding: 0; border-radius: 50%; pointer-events: auto;
  border: 2px solid #fff; color: #111; font-weight: 700; font-size: 12px; line-height: 18px; text-align: center;
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.35); background: var(--tip); }
.badge.warning { background: var(--warning); }
.badge.link { background: var(--link); }
.badge.pin { background: var(--accent); color: var(--on-accent); }
.pop { position: fixed; max-width: 300px; pointer-events: auto; background: var(--bg); color: var(--fg);
  border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; box-shadow: 0 8px 28px rgb(0 0 0 / 0.4); }
.pop p { margin: 0 0 8px; }
.pop a { color: var(--link); }
.kind { font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
.pick { position: fixed; border: 2px dashed var(--ring); background: rgb(251 146 60 / 0.12); border-radius: 4px; }
.banner { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); pointer-events: auto; background: var(--bg);
  color: var(--fg); border: 1px solid var(--ring); border-radius: 10px; padding: 8px 12px; display: flex; gap: 10px; align-items: center; }
@media (prefers-reduced-motion: reduce) { .ring, .cursor { transition: none; } .cursor.clicking::before { animation: none; } }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Rich text as DOM nodes (never innerHTML): bold, italic and http(s)/mailto links. */
function richNodes(rt: RichText): Node[] {
  return rt.spans.map((s) => {
    let node: Node = document.createTextNode(s.text);
    if (s.italic) {
      const em = el('em');
      em.append(node);
      node = em;
    }
    if (s.bold) {
      const b = el('strong');
      b.append(node);
      node = b;
    }
    if (s.href && /^(https?:|mailto:)/i.test(s.href)) {
      const a = el('a', { href: s.href, target: '_blank', rel: 'noopener noreferrer' });
      a.append(node);
      node = a;
    }
    return node;
  });
}

const KEY_NAMES: Record<string, string> = { ' ': 'Space', Escape: 'Esc' };
function keyName(e: KeyboardEvent): string {
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta']
    .filter(Boolean)
    .join('+');
  const key = KEY_NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return mods ? `${mods}+${key}` : key;
}

interface Placed {
  mark: PageMark;
  target: Element | null;
  badge: HTMLButtonElement;
}

/** Guide Me, Run for me, notes, pins and the element picker, in one frame of a page. */
export class GuidePage {
  private host: HTMLElement | undefined;
  private root: ShadowRoot | undefined;
  private target: Element | null = null;
  /** The step currently highlighted. */
  private showing: Step | undefined;
  private refinding = false;
  private ring: HTMLElement | undefined;
  private tip: HTMLElement | undefined;
  private cursor: HTMLElement | undefined;
  private watch: AbortController | undefined;
  private finder: AbortController | undefined;
  private marks: Placed[] = [];
  private pop: HTMLElement | undefined;
  private picking: AbortController | undefined;
  private frame = 0;
  private readonly isTop = window === window.top;

  async init(): Promise<void> {
    browser.runtime.onMessage.addListener(this.onMessage);
    await this.loadMarks();
  }

  // ---------- Shadow host ----------

  private ensureRoot(): ShadowRoot {
    if (this.root && this.host?.isConnected) return this.root;
    this.host = document.createElement('trailmark-guide');
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.root.append(style);
    this.mount();
    return this.root;
  }

  /**
   * Keep the overlay usable: a modal <dialog> makes everything outside it inert, so while one
   * is open the overlay lives inside the topmost one; otherwise it lives in the body.
   */
  private mount(): void {
    if (!this.host) return;
    const modal = Array.from(document.querySelectorAll('dialog'))
      .filter((d) => d.matches(':modal'))
      .at(-1);
    const parent = modal ?? document.body ?? document.documentElement;
    if (this.host.parentElement !== parent) parent.append(this.host);
  }

  /** Keep overlays on their elements while the page scrolls or moves. */
  private loop = () => {
    this.frame = 0;
    this.mount();
    this.position();
    if (this.target || this.marks.length || this.picking)
      this.frame = requestAnimationFrame(this.loop);
  };

  private startLoop(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.loop);
  }

  private position(): void {
    if (this.target && this.ring) {
      if (!this.target.isConnected) {
        this.ring.hidden = true;
        this.refind();
      } else {
        const r = this.target.getBoundingClientRect();
        Object.assign(this.ring.style, {
          left: `${r.left - 4}px`,
          top: `${r.top - 4}px`,
          width: `${r.width + 8}px`,
          height: `${r.height + 8}px`,
        });
        this.ring.hidden = false;
        if (this.tip) this.placeNear(this.tip, r);
      }
    }
    let pageSlot = 0;
    for (const p of this.marks) {
      if (p.target) {
        if (!p.target.isConnected || !isVisible(p.target)) {
          p.badge.hidden = true;
          continue;
        }
        const r = p.target.getBoundingClientRect();
        p.badge.hidden = false;
        p.badge.style.left = `${Math.min(innerWidth - 24, r.right - 10)}px`;
        p.badge.style.top = `${Math.max(2, r.top - 12)}px`;
      } else {
        p.badge.style.left = `${innerWidth - 36}px`;
        p.badge.style.top = `${70 + pageSlot++ * 30}px`;
      }
    }
  }

  /**
   * Put a card next to a rectangle without covering it: below, above, right or left, whichever
   * fits first. In a small frame where none fits, the card is hidden (the side panel still shows
   * the step) rather than covering what the person has to click.
   */
  private placeNear(box: HTMLElement, r: DOMRect): void {
    box.hidden = false;
    const h = box.offsetHeight;
    const w = box.offsetWidth;
    const gap = 12;
    const clampX = (x: number) => Math.min(Math.max(8, x), Math.max(8, innerWidth - w - 8));
    const clampY = (y: number) => Math.min(Math.max(8, y), Math.max(8, innerHeight - h - 8));
    const options = [
      { fits: r.bottom + gap + h <= innerHeight, top: r.bottom + gap, left: clampX(r.left) },
      { fits: r.top - gap - h >= 0, top: r.top - gap - h, left: clampX(r.left) },
      { fits: r.right + gap + w <= innerWidth, top: clampY(r.top), left: r.right + gap },
      { fits: r.left - gap - w >= 0, top: clampY(r.top), left: r.left - gap - w },
    ];
    const spot = options.find((o) => o.fits);
    if (!spot) {
      box.hidden = true;
      return;
    }
    box.style.top = `${spot.top}px`;
    box.style.left = `${spot.left}px`;
  }

  // ---------- Guide Me ----------

  private clearStep(): void {
    this.watch?.abort();
    this.watch = undefined;
    this.showing = undefined;
    this.finder?.abort();
    this.finder = undefined;
    this.ring?.remove();
    this.tip?.remove();
    this.ring = undefined;
    this.tip = undefined;
    this.target = null;
  }

  private async find(step: Step, timeoutMs: number): Promise<Element | null> {
    if (!step.target) return null;
    this.finder?.abort();
    this.finder = new AbortController();
    const found = await waitForTarget(document, step.target, {
      timeoutMs,
      isVisible,
      signal: this.finder.signal,
    });
    return found?.element ?? null;
  }

  /** U7: find a step's element and ring it, never acting on it. */
  private async probe(step: Step, timeoutMs: number): Promise<ProbeReply> {
    this.clearStep();
    if (!step.target) return { status: 'missing' };
    const found = await waitForTarget(document, step.target, { timeoutMs, isVisible });
    if (!found) return { status: 'missing' };
    this.reveal(found.element);
    this.target = found.element;
    this.ring = el('div', { class: 'ring', part: 'ring' });
    this.ensureRoot().append(this.ring);
    this.position();
    this.startLoop();
    return {
      status: found.ambiguous ? 'ambiguous' : 'found',
      strategy: found.strategy,
      confidence: Math.round(found.confidence * 100) / 100,
    };
  }

  private reveal(target: Element): void {
    const r = target.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }

  private async show(
    msg: Extract<GuideToContent, { type: 'guide-show' }>,
  ): Promise<{ found: boolean }> {
    this.clearStep();
    const target = await this.find(msg.step, msg.timeoutMs);
    if (!target) return { found: false };
    this.reveal(target);
    const root = this.ensureRoot();
    this.target = target;
    this.showing = msg.step;
    this.ring = el('div', { class: 'ring', part: 'ring' });
    this.tip = this.tooltip(msg);
    root.append(this.ring, this.tip);
    this.watchFor(msg.step, target);
    this.position();
    this.startLoop();
    return { found: true };
  }

  private tooltip(msg: Extract<GuideToContent, { type: 'guide-show' }>): HTMLElement {
    const tip = el('div', {
      class: 'tip',
      role: 'dialog',
      'aria-label': g.stepOf(msg.number, msg.total),
    });
    tip.append(el('p', { class: 'count' }, g.stepOf(msg.number, msg.total)));
    const title = el('p', { class: 'title' });
    title.append(...richNodes(msg.step.human.title));
    tip.append(title);
    // U4: a value asked for every run is the person's own; a default is offered.
    const input = msg.step.input;
    if (input && !input.sensitive && input.mode !== 'fixed') {
      tip.append(
        el(
          'p',
          { class: 'note' },
          input.mode === 'default' && input.value ? g.suggestedValue(input.value) : g.ownValue,
        ),
      );
    }
    if (msg.phase !== 'showing') {
      tip.append(el('p', { class: 'note' }, g.phase[msg.phase]));
    }
    const close = el(
      'button',
      { class: 'x', type: 'button', 'aria-label': g.close, title: g.close },
      '×',
    );
    close.addEventListener('click', () => this.control('stop'));
    const row = el('div', { class: 'row' });
    const button = (label: string, action: GuideControl, primary = false) => {
      const b = el('button', { type: 'button', ...(primary ? { class: 'primary' } : {}) }, label);
      b.addEventListener('click', () => this.control(action));
      row.append(b);
    };
    if (msg.phase === 'confirm') {
      button(g.confirmSelf, 'pause');
      button(g.confirmDo, 'confirm', true);
    } else {
      if (msg.number > 1) button(g.back, 'back');
      button(g.didIt, 'next', true);
    }
    tip.append(close, row);
    return tip;
  }

  private control(action: GuideControl): void {
    if (action === 'stop' || action === 'next' || action === 'back') this.clearStep();
    void send({ type: 'guide-control', action });
  }

  /** Move on when the person does the step on the highlighted element. */
  /** The app replaced the highlighted element (a re-render): find it again. */
  private refind(): void {
    const step = this.showing;
    if (!step || this.refinding) return;
    this.refinding = true;
    void this.find(step, 5000).then((found) => {
      this.refinding = false;
      if (found && this.showing === step) this.target = found;
    });
  }

  private watchFor(step: Step, target: Element): void {
    this.watch = new AbortController();
    const opts = { capture: true, signal: this.watch.signal };
    // Events like "change" do not leave a shadow root, so listen on every root up to the window.
    const roots: EventTarget[] = [window];
    for (
      let root = target.getRootNode();
      root instanceof ShadowRoot;
      root = root.host.getRootNode()
    )
      roots.push(root);
    const on = (type: string, listener: (e: Event) => void) => {
      for (const r of roots) r.addEventListener(type, listener, opts);
    };
    const inside = (e: Event) => {
      const path = e.composedPath();
      return path.includes(target) || (!!this.target && path.includes(this.target));
    };
    const done = () => {
      if (this.showing !== step) return;
      this.clearStep();
      void send({ type: 'guide-done', stepId: step.id });
    };
    const valueOf = () => {
      const el = this.target ?? target;
      return 'value' in el ? String((el as HTMLInputElement).value) : '';
    };
    const initial = valueOf();
    switch (step.action) {
      case 'type':
      case 'select':
      case 'upload':
        on('change', (e) => inside(e) && done());
        on('focusout', (e) => inside(e) && valueOf() !== initial && done());
        // A drop-down that is not a native select: choosing happens by click.
        if (step.action === 'select' && target.tagName !== 'SELECT')
          on('click', (e) => inside(e) && done());
        break;
      case 'key':
        on('keydown', (e) => keyName(e as KeyboardEvent) === step.key && done());
        break;
      case 'hover':
        on('pointerover', (e) => inside(e) && done());
        break;
      case 'right_click':
        on('contextmenu', (e) => inside(e) && done());
        break;
      case 'double_click':
        on('dblclick', (e) => inside(e) && done());
        break;
      default:
        on('click', (e) => inside(e) && done());
        on('change', (e) => inside(e) && done());
    }
  }

  /** Top frame: bring the iframe holding the next target on screen. */
  private revealFrame(selectors: string[], frameUrl: string): void {
    let frame: Element | null;
    try {
      frame = selectors[0] ? document.querySelector(selectors[0]) : null;
    } catch {
      frame = null; // a selector this page cannot parse
    }
    frame ??=
      Array.from(document.querySelectorAll('iframe, frame')).find(
        (f) => pageKey((f as HTMLIFrameElement).src) === pageKey(frameUrl),
      ) ?? null;
    if (!frame) return;
    const r = frame.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) frame.scrollIntoView({ block: 'center' });
  }

  // ---------- Run for me ----------

  private async run(
    msg: Extract<GuideToContent, { type: 'guide-run' }>,
  ): Promise<{ result: 'acted' | 'not-found' | 'cannot' }> {
    this.clearStep();
    const target = await this.find(msg.step, msg.timeoutMs);
    if (!target) return { result: 'not-found' };
    if (!canPerform(target, msg.step, msg.value)) return { result: 'cannot' };
    this.reveal(target);
    await this.moveCursor(target, CURSOR_MS[msg.speed]);
    // Reply first: the action may replace this page before a reply could get out.
    setTimeout(() => {
      this.cursor?.classList.add('clicking');
      performStep(target, msg.step, msg.value);
      setTimeout(() => this.cursor?.classList.remove('clicking'), 400);
    }, 30);
    return { result: 'acted' };
  }

  private async moveCursor(target: Element, ms: number): Promise<void> {
    const root = this.ensureRoot();
    if (!this.cursor?.isConnected) {
      this.cursor = el('div', { class: 'cursor', part: 'cursor' });
      Object.assign(this.cursor.style, {
        left: `${innerWidth / 2}px`,
        top: `${innerHeight / 2}px`,
      });
      root.append(this.cursor);
      this.cursor.getBoundingClientRect(); // start the transition from here
    }
    const r = target.getBoundingClientRect();
    this.cursor.style.transitionDuration = `${ms}ms`;
    this.cursor.style.left = `${r.left + r.width / 2}px`;
    this.cursor.style.top = `${r.top + r.height / 2}px`;
    await new Promise((resolve) => setTimeout(resolve, ms + 30));
  }

  // ---------- Notes and pins ----------

  private async loadMarks(): Promise<void> {
    const reply = (await send({ type: 'guide-hello' })) as
      { marks?: PageMark[]; enabled?: boolean } | undefined;
    this.clearMarks();
    if (!reply?.enabled || !reply.marks?.length) return;
    const root = this.ensureRoot();
    for (const mark of reply.marks) {
      const badge = el(
        'button',
        {
          class: `badge ${mark.kind === 'pin' ? 'pin' : mark.tone}`,
          type: 'button',
          'aria-label': m.badge(mark.kind === 'pin' ? m.pin : m.note),
          'data-mark': mark.id,
        },
        mark.kind === 'pin' ? '➜' : mark.tone === 'warning' ? '!' : 'i',
      );
      badge.hidden = true;
      const placed: Placed = { mark, target: null, badge };
      badge.addEventListener('click', () => this.openPop(placed));
      badge.addEventListener('mouseenter', () => this.openPop(placed));
      root.append(badge);
      this.marks.push(placed);
      if (mark.target) {
        void waitForTarget(document, mark.target, { timeoutMs: 5000, isVisible }).then((found) => {
          placed.target = found?.element ?? null;
          this.startLoop();
        });
      } else {
        badge.hidden = false;
      }
    }
    this.position();
    this.startLoop();
  }

  private clearMarks(): void {
    for (const p of this.marks) p.badge.remove();
    this.marks = [];
    this.pop?.remove();
  }

  private openPop(p: Placed): void {
    this.pop?.remove();
    const root = this.ensureRoot();
    const pop = el('div', {
      class: 'pop',
      role: 'dialog',
      'aria-label': m.badge(p.mark.kind === 'pin' ? m.pin : m.note),
    });
    pop.append(el('p', { class: 'kind' }, p.mark.kind === 'pin' ? m.pin : m.tones[p.mark.tone]));
    if (p.mark.text.spans.length) {
      const text = el('p');
      text.append(...richNodes(p.mark.text));
      pop.append(text);
    }
    if (p.mark.href) {
      const link = el(
        'a',
        { href: p.mark.href, target: '_blank', rel: 'noopener noreferrer' },
        p.mark.href,
      );
      const para = el('p');
      para.append(link);
      pop.append(para);
    }
    const guideId = p.mark.guideId;
    if (guideId) {
      const row = el('div', { class: 'row' });
      const open = el('button', { type: 'button' }, m.openGuide);
      open.addEventListener(
        'click',
        () => void send({ type: 'open-guide', guideId, mode: 'view' }),
      );
      const guide = el('button', { type: 'button', class: 'primary' }, m.guideMe);
      guide.addEventListener('click', () => {
        pop.remove();
        void send({ type: 'open-guide', guideId, mode: 'guide' });
      });
      row.append(open, guide);
      pop.append(row);
    }
    const close = el('button', { class: 'x', type: 'button', 'aria-label': m.cancel }, '×');
    close.addEventListener('click', () => pop.remove());
    pop.append(close);
    root.append(pop);
    this.pop = pop;
    this.placeNear(pop, p.badge.getBoundingClientRect());
  }

  // ---------- Picker ----------

  private pick(on: boolean): void {
    this.picking?.abort();
    this.picking = undefined;
    const root = this.ensureRoot();
    root.querySelectorAll('.pick, .banner').forEach((n) => n.remove());
    if (!on) return;
    const ctrl = new AbortController();
    this.picking = ctrl;
    const box = el('div', { class: 'pick' });
    box.hidden = true;
    root.append(box);
    if (this.isTop) {
      const banner = el('div', { class: 'banner', role: 'status' });
      banner.append(el('span', {}, m.pickBanner));
      const whole = el('button', { type: 'button' }, m.wholePage);
      whole.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pick(false);
        void send({ type: 'picked' });
      });
      banner.append(whole);
      root.append(banner);
    }
    let hovered: Element | null = null;
    const opts = { capture: true, signal: ctrl.signal };
    window.addEventListener(
      'pointermove',
      (e) => {
        const t = e.composedPath()[0];
        if (!(t instanceof Element) || t === this.host) return;
        hovered = toActionable(t);
        const r = hovered.getBoundingClientRect();
        Object.assign(box.style, {
          left: `${r.left}px`,
          top: `${r.top}px`,
          width: `${r.width}px`,
          height: `${r.height}px`,
        });
        box.hidden = false;
      },
      opts,
    );
    const swallow = (e: Event) => {
      if (e.composedPath().includes(this.host as EventTarget)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('pointerdown', swallow, opts);
    window.addEventListener('mousedown', swallow, opts);
    window.addEventListener(
      'click',
      (e) => {
        if (e.composedPath().includes(this.host as EventTarget)) return;
        swallow(e);
        const t = e.composedPath()[0];
        const chosen = t instanceof Element ? toActionable(t) : hovered;
        this.pick(false);
        if (chosen) void send({ type: 'picked', target: describeElement(chosen) });
      },
      opts,
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        swallow(e);
        this.pick(false);
        void send({ type: 'picked', cancelled: true });
      },
      opts,
    );
    this.startLoop();
  }

  // ---------- Messages ----------

  private readonly onMessage = (
    raw: unknown,
    _sender: unknown,
    sendResponse: (r: unknown) => void,
  ): boolean | undefined => {
    const parsed = GuideToContentSchema.safeParse(raw);
    if (!parsed.success) return undefined;
    const msg = parsed.data;
    switch (msg.type) {
      case 'guide-show':
        void this.show(msg).then(sendResponse);
        return true;
      case 'guide-run':
        void this.run(msg).then(sendResponse);
        return true;
      case 'guide-frame':
        if (this.isTop) this.revealFrame(msg.frames, msg.frameUrl);
        sendResponse({ ok: true });
        return undefined;
      case 'guide-clear':
        this.clearStep();
        sendResponse({ ok: true });
        return undefined;
      case 'guide-probe':
        void this.probe(msg.step, msg.timeoutMs).then(sendResponse);
        return true;
      case 'guide-check':
        sendResponse({
          failed: failedExpectations(document, location.href, msg.step.agent.expect, {
            isVisible,
          }).map((e) => e.type),
        });
        return undefined;
      case 'marks-changed':
        void this.loadMarks();
        return undefined;
      case 'pick':
        this.pick(msg.on);
        sendResponse({ ok: true });
        return undefined;
    }
  };
}
