import {
  attachProblem,
  canPerform,
  deepElements,
  fileInputFor,
  setInputFile,
  describeElement,
  failedExpectations,
  isSensitiveField,
  pageKey,
  performStep,
  toActionable,
  waitForTarget,
  type PageMark,
  type RichText,
  type Step,
} from '@showsteps/core';
import { iconSvg } from '@showsteps/ui/icons';
import { strings } from '@showsteps/ui/strings';
import { CHROME_BASE_CSS } from './chromeStyle';
import { base64ToBytes, blobToBase64, linkFileName } from '../fileData';
import { MAX_FILE_BYTES } from '../runfiles';
import type { z } from 'zod';
import {
  GuideToContentSchema,
  type FilePayload,
  type RunReplySchema,
  type GuideContentMessage,
  type GuideControl,
  type FileHint,
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

type RunReply = z.infer<typeof RunReplySchema>;

/** "Choose the file you downloaded in step 2" (Guide Me), or with its name when known. */
function fileHintText(hint: FileHint): string {
  return hint.name ? g.chooseFileNamed(hint.name, hint.step) : g.chooseFile(hint.step);
}

/**
 * The file a link holds, read in the page before Run for me clicks it: a `blob:` or `data:`
 * address, or (`fetchLink`, when ShowSteps has no download access) a same-site link with a
 * `download` attribute, fetched with the page's own cookies. Nothing else is fetched.
 */
async function grabLinkFile(
  target: Element,
  fetchLink: boolean,
): Promise<Pick<RunReply, 'file' | 'tooBig'> | undefined> {
  const link = target.closest('a[href]');
  if (!(link instanceof HTMLAnchorElement)) return undefined;
  const href = link.href;
  const inPage = /^(blob|data):/i.test(href);
  const sameSite = /^https?:$/.test(link.protocol) && link.origin === location.origin;
  if (!inPage && !(fetchLink && sameSite && link.hasAttribute('download'))) return undefined;
  const name = linkFileName(link.getAttribute('download'), href);
  try {
    const res = await fetch(href, inPage ? undefined : { credentials: 'include' });
    if (!res.ok) return undefined;
    // A sign-in page instead of the file: not something to attach.
    if (
      !inPage &&
      /text\/html/i.test(res.headers.get('content-type') ?? '') &&
      !/\.html?$/i.test(name)
    )
      return undefined;
    if (Number(res.headers.get('content-length') ?? 0) > MAX_FILE_BYTES)
      return { tooBig: { name } };
    const blob = await res.blob();
    if (blob.size > MAX_FILE_BYTES) return { tooBig: { name } };
    return { file: { name, type: blob.type, data: await blobToBase64(blob) } };
  } catch {
    return undefined;
  }
}

/** Visible on screen: has boxes and is not visibility:hidden. */
function isVisible(el: Element): boolean {
  if (!el.getClientRects().length) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

const CSS = `${CHROME_BASE_CSS}
:host { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
.ring { position: fixed; border: 3px solid var(--ss-chrome-signal); border-radius: 12px;
  box-shadow: 0 0 0 6px var(--ss-spot-halo), 0 0 0 100vmax var(--ss-spot-backdrop);
  transition: all 120ms cubic-bezier(.2,.8,.2,1); }
.tip { position: fixed; width: 340px; max-width: calc(100vw - 24px); pointer-events: auto; overflow: hidden;
  background: var(--ss-chrome-bg); color: var(--ss-chrome-fg); border: 1px solid var(--ss-chrome-line);
  border-radius: 12px; padding: 14px 16px 16px; box-shadow: var(--ss-chrome-shadow);
  animation: rise 200ms cubic-bezier(.2,.8,.2,1); }
@keyframes rise { from { opacity: 0; transform: translateY(4px); } }
.tip.confirm { border-color: var(--ss-chrome-alert); }
.count { color: var(--ss-chrome-step); font-size: 12px; line-height: 16px; font-weight: 700;
  letter-spacing: .02em; margin: 0 28px 6px 0; }
.title { margin: 0 0 8px; font-size: 14px; line-height: 20px; font-weight: 600; }
.title strong { font-weight: 800; }
.title a { color: var(--ss-chrome-step); }
.note { margin: 0 0 10px; color: var(--ss-chrome-muted); font-size: 13px; line-height: 18px; }
.confirm .note { color: var(--ss-chrome-alert); }
.row { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; margin-top: 10px; }
.row .grow { flex: 1; }
button { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px;
  font: inherit; font-size: 13px; font-weight: 600; color: var(--ss-chrome-fg); background: transparent;
  border: 0; border-radius: 999px; cursor: pointer; transition: background-color 120ms cubic-bezier(.2,.8,.2,1); }
button:hover { background: var(--ss-chrome-button); }
button:focus-visible { outline: 2px solid var(--ss-chrome-signal); outline-offset: 2px; }
button.primary { background: var(--ss-chrome-signal); color: var(--ss-chrome-on-signal); padding: 0 16px; }
button.primary:hover { background: var(--ss-chrome-step); }
.x { position: absolute; top: 8px; right: 8px; width: 32px; min-height: 32px; padding: 0; justify-content: center;
  color: var(--ss-chrome-muted); }
.progress { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--ss-chrome-signal);
  transition: width 200ms cubic-bezier(.2,.8,.2,1); }
.cursor { position: fixed; width: 22px; height: 22px; margin: -3px 0 0 -3px; transition-property: left, top;
  transition-timing-function: ease-in-out; filter: drop-shadow(0 2px 3px var(--ss-spot-backdrop)); }
.cursor::after { content: ''; position: absolute; inset: 0; clip-path: polygon(0 0, 0 80%, 25% 60%, 45% 100%, 58% 94%, 40% 56%, 72% 56%);
  background: var(--ss-spot-pointer); outline: none; }
.cursor.clicking::before { content: ''; position: absolute; left: -14px; top: -14px; width: 30px; height: 30px;
  border-radius: 50%; border: 3px solid var(--ss-chrome-signal); animation: ripple 400ms ease-out forwards; }
@keyframes ripple { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
.badge { position: fixed; width: 24px; height: 24px; padding: 0; min-height: 0; justify-content: center;
  border-radius: 50%; pointer-events: auto; border: 2px solid var(--ss-chrome-bg); color: var(--ss-chrome-bg);
  font-weight: 800; font-size: 12px; line-height: 20px; box-shadow: var(--ss-chrome-shadow); background: var(--ss-chrome-tip); }
.badge:hover { background: var(--ss-chrome-tip); filter: brightness(1.08); }
.badge.warning, .badge.warning:hover { background: var(--ss-chrome-warning); }
.badge.link, .badge.link:hover { background: var(--ss-chrome-note); }
.badge.pin, .badge.pin:hover { background: var(--ss-chrome-signal); color: var(--ss-chrome-on-signal); }
.pop { position: fixed; max-width: 300px; pointer-events: auto; background: var(--ss-chrome-bg); color: var(--ss-chrome-fg);
  border: 1px solid var(--ss-chrome-line); border-radius: 12px; padding: 12px 14px; box-shadow: var(--ss-chrome-shadow); }
.pop p { margin: 0 0 8px; }
.pop a { color: var(--ss-chrome-step); }
.kind { font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--ss-chrome-muted); }
.pick { position: fixed; border: 2px dashed var(--ss-chrome-signal); background: var(--ss-spot-pick); border-radius: 6px; }
.banner { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); pointer-events: auto;
  background: var(--ss-chrome-bg); color: var(--ss-chrome-fg); border: 1px solid var(--ss-chrome-line);
  border-radius: 999px; padding: 6px 6px 6px 16px; display: flex; gap: 10px; align-items: center;
  box-shadow: var(--ss-chrome-shadow); }
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
  private notice: HTMLElement | undefined;
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
    this.host = document.createElement('showsteps-guide');
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
    this.notice?.remove();
    this.ring = undefined;
    this.tip = undefined;
    this.notice = undefined;
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
  private async probe(step: Step, timeoutMs: number, fileField = false): Promise<ProbeReply> {
    this.clearStep();
    if (!step.target) return { status: 'missing' };
    // An upload step's file field is often hidden behind a button: it counts when it's there.
    const found = await waitForTarget(document, step.target, {
      timeoutMs,
      isVisible: fileField ? () => true : isVisible,
    });
    if (!found || (fileField && !fileInputFor(found.element))) return { status: 'missing' };
    if (!isVisible(found.element))
      return {
        status: found.ambiguous ? 'ambiguous' : 'found',
        strategy: found.strategy,
        confidence: Math.round(found.confidence * 100) / 100,
      };
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
    const confirm = msg.phase === 'confirm';
    const tip = el('div', {
      class: confirm ? 'tip confirm' : 'tip',
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
    if (msg.hint) tip.append(el('p', { class: 'note' }, fileHintText(msg.hint)));
    if (msg.phase !== 'showing') {
      tip.append(el('p', { class: 'note' }, g.phase[msg.phase]));
    }
    const close = el('button', {
      class: 'x',
      type: 'button',
      'aria-label': g.close,
      title: g.close,
    });
    close.innerHTML = iconSvg('x', 18);
    close.addEventListener('click', () => this.control('stop'));
    const row = el('div', { class: 'row' });
    const button = (label: string, action: GuideControl, cls = '') => {
      const b = el('button', { type: 'button', ...(cls ? { class: cls } : {}) }, label);
      b.addEventListener('click', () => this.control(action));
      row.append(b);
    };
    if (confirm) {
      button(g.confirmSelf, 'pause');
      row.append(el('span', { class: 'grow' }));
      button(g.confirmDo, 'confirm', 'primary');
    } else {
      if (msg.number > 1) button(g.back, 'back');
      button(g.skip, 'skip');
      row.append(el('span', { class: 'grow' }));
      button(g.didIt, 'next', 'primary');
    }
    const progress = el('div', { class: 'progress', 'aria-hidden': 'true' });
    progress.style.width = `${Math.round((msg.number / msg.total) * 100)}%`;
    tip.append(close, row, progress);
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

  private async run(msg: Extract<GuideToContent, { type: 'guide-run' }>): Promise<RunReply> {
    this.clearStep();
    if (msg.attach) return this.attach(msg.step, msg.attach, msg.timeoutMs, msg.speed);
    const target = await this.find(msg.step, msg.timeoutMs);
    if (!target) return { result: 'not-found' };
    if (!canPerform(target, msg.step, msg.value)) return { result: 'cannot' };
    // Read the link's file before the click: pages often revoke a blob: address right after.
    const grabbed = msg.grab ? await grabLinkFile(target, msg.grab.fetchLink) : undefined;
    this.reveal(target);
    await this.moveCursor(target, CURSOR_MS[msg.speed]);
    // Reply first: the action may replace this page before a reply could get out.
    setTimeout(() => {
      this.cursor?.classList.add('clicking');
      performStep(target, msg.step, msg.value);
      setTimeout(() => this.cursor?.classList.remove('clicking'), 400);
    }, 30);
    return { result: 'acted', ...grabbed };
  }

  /**
   * An attach step: find the field (a hidden file input counts) and set the run's file on it.
   * A synthetic click can't open Chrome's file chooser, so nothing else is clicked.
   */
  private async attach(
    step: Step,
    file: FilePayload,
    timeoutMs: number,
    speed: Speed,
  ): Promise<RunReply> {
    if (!step.target) return { result: 'not-found' };
    const found = await waitForTarget(document, step.target, {
      timeoutMs,
      isVisible: () => true,
    });
    if (!found) return { result: 'not-found' };
    const input = fileInputFor(found.element);
    if (!input) return { result: 'cannot' };
    const w = input.ownerDocument.defaultView ?? window;
    const chosen = new w.File([base64ToBytes(file.data)], file.name, { type: file.type });
    if (attachProblem(input, chosen)) return { result: 'cannot', reason: 'file-type' };
    // The pointer goes to whatever shows on screen: the field, or the element the step names.
    const shown = isVisible(input) ? input : isVisible(found.element) ? found.element : undefined;
    if (shown) {
      this.reveal(shown);
      await this.moveCursor(shown, CURSOR_MS[speed]);
    }
    setInputFile(input, chosen);
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
        void this.probe(msg.step, msg.timeoutMs, msg.fileField).then(sendResponse);
        return true;
      case 'guide-check': {
        // The top page checks its own expectations; an iframe checks those marked for it.
        const inFrame = window !== window.top;
        const mine = (msg.step.agent.expect ?? []).filter(
          (e) => ('inFrame' in e && e.inFrame === true) === inFrame,
        );
        sendResponse({
          failed: failedExpectations(document, location.href, mine, { isVisible }).map(
            (e) => e.type,
          ),
        });
        return undefined;
      }
      case 'marks-changed':
        void this.loadMarks();
        return undefined;
      case 'pick':
        this.pick(msg.on);
        sendResponse({ ok: true });
        return undefined;
      case 'guide-signin':
        if (!this.isTop) return undefined;
        sendResponse({
          host: location.hostname,
          secretField: deepElements(document).some((e) => isSensitiveField(e) && isVisible(e)),
        });
        return undefined;
      case 'guide-notice':
        if (!this.isTop) return undefined;
        this.showNotice();
        sendResponse({ ok: true });
        return undefined;
    }
  };

  /** Run for me stopped at a sign-in page: say so across the top, with Continue. */
  private showNotice(): void {
    this.clearStep();
    const banner = el('div', { class: 'banner', role: 'alert' });
    banner.append(el('span', {}, g.signIn));
    const go = el('button', { type: 'button', class: 'primary' }, g.continue);
    go.addEventListener('click', () => this.control('retry'));
    banner.append(go);
    this.notice = banner;
    this.ensureRoot().append(banner);
  }
}
