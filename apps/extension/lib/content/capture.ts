import {
  collectPageText,
  deepElements,
  expectationsFrom,
  pageState,
  describeElement,
  frameSelector,
  getRole,
  isSensitiveField,
  isTextEntry,
  toActionable,
  type Target,
} from '@showsteps/core';
import {
  BackgroundToContentSchema,
  IDLE_STATE,
  type CaptureState,
  type ContentEvent,
  type ContentMessage,
  type IframeGeometry,
} from '../messages';
import { Controller } from './controller';
import { LiveBlur } from './liveBlur';

const FRAME_HELLO = 'showsteps:frame-hello';
/** Actions whose result is worth recording as an expectation, and when to look (U6). */
const OBSERVED = new Set<ContentEvent['kind']>(['click', 'dblclick', 'key', 'select', 'check']);
const OBSERVE_AFTER_MS = 800;
const FRAME_HELLO_REQUEST = 'showsteps:frame-hello-request';
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);
const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  Escape: 'Esc',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

function send(msg: ContentMessage): Promise<unknown> {
  return browser.runtime.sendMessage(msg).catch(() => undefined);
}

/** Recorder that runs in every frame of a page while a capture is active. */
export class PageRecorder {
  private state: CaptureState = { ...IDLE_STATE };
  private readonly isTop = window === window.top;
  private readonly token = crypto.randomUUID();
  private readonly childFrames = new Map<string, Element>();
  private readonly keys = new WeakMap<Element, string>();
  private keyCounter = 0;
  private readonly baseline = new WeakMap<Element, string>();
  private readonly committed = new WeakMap<Element, string>();
  private lastPointer: { el: Element; at: number } | undefined;
  private listening = false;
  /** A state pushed by the background is newer than any reply to our earlier hello. */
  private pushed = false;
  private controller: Controller | undefined;
  private readonly blur = new LiveBlur();
  private outline: HTMLElement | undefined;

  async init(): Promise<void> {
    window.addEventListener('message', this.onWindowMessage);
    browser.runtime.onMessage.addListener(this.onRuntimeMessage);
    if (!this.isTop) {
      void send({ type: 'frame-register', token: this.token });
      this.announceToParent();
    }
    const reply = (await send({ type: 'hello' })) as { state?: CaptureState } | undefined;
    if (reply?.state && !this.pushed) this.apply(reply.state);
  }

  // ---------- State ----------

  private apply(state: CaptureState): void {
    this.state = state;
    if (state.status === 'idle') {
      this.teardown();
      return;
    }
    this.listen();
    if (this.isTop) this.ensureController(state);
    if (!state.liveBlur) this.hideOutline();
  }

  private ensureController(state: CaptureState) {
    const mount = () => {
      this.controller ??= new Controller((action) => {
        void send({ type: 'control', action });
      });
      this.controller.mount();
      this.controller.update(state);
    };
    if (document.documentElement) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
    this.reportViewport();
  }

  private teardown(): void {
    if (this.listening) {
      window.removeEventListener('pointerdown', this.onPointerDown, true);
      window.removeEventListener('click', this.onClick, true);
      window.removeEventListener('dblclick', this.onDblClick, true);
      window.removeEventListener('change', this.onChange, true);
      window.removeEventListener('keydown', this.onKeyDown, true);
      window.removeEventListener('focusin', this.onFocusIn, true);
      window.removeEventListener('focusout', this.onFocusOut, true);
      window.removeEventListener('pointerover', this.onPointerOver, true);
      window.removeEventListener('resize', this.reportViewport);
      window.removeEventListener('blur', this.onWindowBlur);
      this.listening = false;
    }
    this.controller?.unmount();
    this.hideOutline();
    this.blur.clear();
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('dblclick', this.onDblClick, true);
    window.addEventListener('change', this.onChange, true);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('focusin', this.onFocusIn, true);
    window.addEventListener('focusout', this.onFocusOut, true);
    window.addEventListener('pointerover', this.onPointerOver, true);
    if (this.isTop) window.addEventListener('resize', this.reportViewport);
    window.addEventListener('blur', this.onWindowBlur);
  }

  private readonly reportViewport = () => {
    if (!this.isTop) return;
    void send({
      type: 'viewport',
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    });
  };

  // ---------- Helpers ----------

  private get recording(): boolean {
    return this.state.status === 'recording';
  }

  private ours(e: Event): boolean {
    const path = e.composedPath();
    return (
      (!!this.controller && this.controller.contains(path)) ||
      (!!this.outline && path.includes(this.outline))
    );
  }

  private keyOf(el: Element): string {
    let k = this.keys.get(el);
    if (!k) {
      k = `${this.token.slice(0, 8)}:${++this.keyCounter}`;
      this.keys.set(el, k);
    }
    return k;
  }

  private describe(el: Element, point?: { x: number; y: number }): Target {
    return describeElement(
      el,
      point ? { point: { x: Math.round(point.x), y: Math.round(point.y) } } : {},
    );
  }

  /**
   * Request the screenshot, then send the event straight away: the page may unload right after
   * this input (e.g. a sign-in that loads a new page), and the background pairs the two by id.
   */
  private record(event: ContentEvent, withShot: boolean): void {
    const shotId = withShot ? crypto.randomUUID() : undefined;
    if (shotId) {
      // Hide our toolbar, then ask for the picture once that has been painted. The input time
      // lets the background discard a picture that arrives after the page was replaced.
      const at = Date.now();
      // Where each word is on screen, for Secure Blur (top frame: its viewport is the picture).
      // Read only once the picture has been asked for: reading earlier would hold up the paint
      // the request waits for, and a fast click could change the page first.
      const sendWords = () => {
        if (window !== window.top) return;
        const words = collectPageText(document, {
          skip: (el) => el.localName.startsWith('showsteps-'),
        });
        void send({ type: 'shot-words', shotId, words });
      };
      const controller = this.controller;
      if (controller)
        void controller.hideFor().then(() => {
          void send({ type: 'shot', shotId, uiHidden: true, at });
          sendWords();
        });
      else {
        void send({ type: 'shot', shotId, at });
        sendWords();
      }
    }
    const observeId = this.observe(event);
    void send({
      type: 'event',
      ...(shotId ? { shotId } : {}),
      ...(observeId ? { observeId } : {}),
      event,
    });
  }

  /**
   * U6: for actions that change pages (clicks, keys, choices) in the top frame, note the page
   * now and again shortly after, and report the difference as the step's expected result.
   */
  private observe(event: ContentEvent): string | undefined {
    if (!OBSERVED.has(event.kind)) return undefined;
    const observeId = crypto.randomUUID();
    // An action in an iframe often changes the page around it: the top frame looks too.
    if (!this.isTop) void send({ type: 'observe-top', observeId });
    this.observeNow(observeId);
    return observeId;
  }

  /** Note the page now and again shortly after; report what changed under `observeId`. */
  observeNow(observeId: string): void {
    const before = pageState(document);
    setTimeout(() => {
      const expect = expectationsFrom(before, pageState(document), { inFrame: !this.isTop });
      if (expect.length) void send({ type: 'observed', observeId, expect });
    }, OBSERVE_AFTER_MS);
  }

  private activeElementDeep(): Element | null {
    let el: Element | null = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  private valueOf(el: Element): string {
    if ('value' in el && typeof (el as HTMLInputElement).value === 'string')
      return (el as HTMLInputElement).value;
    return (el as HTMLElement).innerText ?? el.textContent ?? '';
  }

  /**
   * The typing event for a field whose value changed since focus or the last commit, marking
   * it committed; undefined when there is nothing new.
   */
  private takeTyping(el: Element): ContentEvent | undefined {
    if (!isTextEntry(el)) return undefined;
    const value = this.valueOf(el);
    const before = this.committed.get(el) ?? this.baseline.get(el) ?? '';
    if (value === before) return undefined;
    this.committed.set(el, value);
    const sensitive = isSensitiveField(el);
    return {
      kind: 'type',
      target: this.describe(el),
      element: this.keyOf(el),
      sensitive,
      ...(sensitive ? {} : { value }),
    };
  }

  /** Record typed text if the field's value changed since focus or the last commit. */
  private commitTyping(el: Element, withShot = true): boolean {
    const event = this.takeTyping(el);
    if (event) this.record(event, withShot);
    return !!event;
  }

  private commitPendingTyping(except?: Element, withShot = true): void {
    const active = this.activeElementDeep();
    if (active && active !== except && isTextEntry(active)) this.commitTyping(active, withShot);
  }

  /** Whether a change event belongs to the element the user just clicked (merge, no new shot). */
  private justClicked(el: Element): boolean {
    return (
      !!this.lastPointer && this.lastPointer.el === el && Date.now() - this.lastPointer.at < 5000
    );
  }

  // ---------- Event handlers ----------

  private readonly onPointerDown = (e: PointerEvent) => {
    if (!e.isTrusted || !this.recording || this.state.liveBlur || this.ours(e)) return;
    if (e.button !== 0 && e.button !== 2) return;
    const raw = e.composedPath()[0];
    if (!(raw instanceof Element)) return;
    const el = toActionable(raw);
    this.commitPendingTyping(el);
    this.lastPointer = { el, at: Date.now() };
    const target = this.describe(el, { x: e.clientX, y: e.clientY });
    const element = this.keyOf(el);
    if (e.button === 2) {
      this.record({ kind: 'click', button: 'right', target, element }, true);
      return;
    }
    this.record({ kind: 'click', button: 'left', target, element, ...this.toggleOf(el) }, true);
  };

  private toggleOf(el: Element): { toggle?: { role: 'checkbox' | 'radio'; checked: boolean } } {
    const role = getRole(el);
    if (role !== 'checkbox' && role !== 'radio' && role !== 'switch') return {};
    const native =
      el.localName === 'input'
        ? (el as HTMLInputElement).checked
        : el.getAttribute('aria-checked') === 'true';
    const checked = role === 'radio' ? true : !native;
    return { toggle: { role: role === 'radio' ? 'radio' : 'checkbox', checked } };
  }

  private readonly onClick = (e: MouseEvent) => {
    if (!e.isTrusted || !this.state.liveBlur || this.ours(e)) return;
    // Live Blur mode: clicks mark elements instead of activating them.
    e.preventDefault();
    e.stopImmediatePropagation();
    const raw = e.composedPath()[0];
    if (raw instanceof Element) this.blur.toggle(raw);
  };

  private readonly onPointerOver = (e: PointerEvent) => {
    if (!this.state.liveBlur || this.ours(e)) return;
    const raw = e.composedPath()[0];
    if (raw instanceof Element) this.showOutline(raw);
  };

  private readonly onDblClick = (e: MouseEvent) => {
    if (!e.isTrusted || !this.recording || this.state.liveBlur || this.ours(e)) return;
    const raw = e.composedPath()[0];
    if (!(raw instanceof Element)) return;
    const el = toActionable(raw);
    this.commitPendingTyping(el);
    this.record({ kind: 'dblclick', target: this.describe(el), element: this.keyOf(el) }, false);
  };

  // Value changes are accepted from scripts too (frameworks and test tools set values that way).
  private readonly onChange = (e: Event) => {
    if (!this.recording || this.ours(e)) return;
    const el = e.composedPath()[0];
    if (!(el instanceof Element)) return;
    const shot = !this.justClicked(el);
    const tag = el.localName;
    if (!isTextEntry(el)) this.commitPendingTyping(el);
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (tag === 'select') {
      const select = el as HTMLSelectElement;
      const value = isSensitiveField(el)
        ? ''
        : Array.from(select.selectedOptions)
            .map((o) => o.label || o.text)
            .join(', ');
      this.record(
        { kind: 'select', target: this.describe(el), element: this.keyOf(el), value },
        shot,
      );
    } else if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
      const role = type === 'radio' ? 'radio' : 'checkbox';
      const checked = (el as HTMLInputElement).checked;
      this.record(
        { kind: 'check', target: this.describe(el), element: this.keyOf(el), checked, role },
        shot,
      );
    } else if (tag === 'input' && type === 'file') {
      const files = Array.from((el as HTMLInputElement).files ?? []).map((f) => f.name);
      if (files.length)
        this.record(
          { kind: 'upload', target: this.describe(el), element: this.keyOf(el), files },
          shot,
        );
    } else if (isTextEntry(el)) {
      this.commitTyping(el);
    }
  };

  private readonly onFocusIn = (e: FocusEvent) => {
    const el = e.composedPath()[0];
    if (el instanceof Element && isTextEntry(el) && !this.baseline.has(el))
      this.baseline.set(el, this.valueOf(el));
  };

  private readonly onFocusOut = (e: FocusEvent) => {
    if (!this.recording) return;
    const el = e.composedPath()[0];
    // contenteditable has no change event: commit when focus leaves.
    if (
      el instanceof Element &&
      el.localName !== 'input' &&
      el.localName !== 'textarea' &&
      isTextEntry(el)
    ) {
      this.commitTyping(el);
    }
  };

  /** Switching tab or window does not fire "change": commit typing when the page loses focus. */
  private readonly onWindowBlur = (e: FocusEvent) => {
    // No screenshot: another tab or window is now in front.
    if (e.target === window && this.recording) this.commitPendingTyping(undefined, false);
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!e.isTrusted || !this.recording || this.ours(e) || MODIFIER_KEYS.has(e.key)) return;
    const mods = e.ctrlKey || e.metaKey || e.altKey;
    const named = e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape';
    if (!named && !mods) return;
    const raw = e.composedPath()[0];
    const el = raw instanceof Element ? raw : null;
    let committed = false;
    if (el && isTextEntry(el)) committed = this.commitTyping(el);
    const multiline =
      el && (el.localName === 'textarea' || (isTextEntry(el) && el.localName !== 'input'));
    if (e.key === 'Enter' && multiline && !mods) return; // a new line, not a command
    if (e.key === 'Tab' && !mods && committed) return; // moving on after typing is implied
    const key = formatKey(e);
    const onPage = !el || el === document.body || el === document.documentElement;
    this.record(
      {
        kind: 'key',
        key,
        ...(onPage || !el ? {} : { target: this.describe(el), element: this.keyOf(el) }),
      },
      true,
    );
  };

  // ---------- Live Blur outline ----------

  private showOutline(el: Element) {
    if (!this.outline) {
      this.outline = document.createElement('showsteps-outline');
      const root = this.outline.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<style>:host{all:initial;position:fixed;pointer-events:none;z-index:2147483646;' +
        'border:2px dashed #4fbfb2;border-radius:4px;box-sizing:border-box}</style>';
      document.documentElement.append(this.outline);
    }
    const r = el.getBoundingClientRect();
    Object.assign(this.outline.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      display: '',
    });
  }

  private hideOutline() {
    this.outline?.remove();
    this.outline = undefined;
  }

  // ---------- Frames ----------

  private announceToParent() {
    window.parent.postMessage({ type: FRAME_HELLO, token: this.token }, '*');
  }

  private readonly onWindowMessage = (e: MessageEvent) => {
    const data = e.data as { type?: unknown; token?: unknown } | null;
    if (!data || typeof data !== 'object') return;
    if (data.type === FRAME_HELLO_REQUEST && e.source === window.parent && !this.isTop) {
      this.announceToParent();
    } else if (
      data.type === FRAME_HELLO &&
      typeof data.token === 'string' &&
      /^[0-9a-f-]{36}$/.test(data.token)
    ) {
      const iframe = this.iframeFor(e.source);
      if (iframe) this.childFrames.set(data.token, iframe);
    }
  };

  private iframeFor(source: MessageEventSource | null): Element | undefined {
    if (!source) return undefined;
    return deepElements(document).find(
      (el) =>
        (el.localName === 'iframe' || el.localName === 'frame') &&
        (el as HTMLIFrameElement).contentWindow === source,
    );
  }

  private async geometry(token: string): Promise<IframeGeometry> {
    let iframe = this.childFrames.get(token);
    if (!iframe) {
      // Child may have announced itself before this script loaded: ask again.
      for (const el of deepElements(document)) {
        if (el.localName === 'iframe' || el.localName === 'frame') {
          (el as HTMLIFrameElement).contentWindow?.postMessage({ type: FRAME_HELLO_REQUEST }, '*');
        }
      }
      await new Promise((r) => setTimeout(r, 100));
      iframe = this.childFrames.get(token);
    }
    if (!iframe?.isConnected) return null;
    const r = iframe.getBoundingClientRect();
    const cs = getComputedStyle(iframe);
    const x = r.left + iframe.clientLeft + parseFloat(cs.paddingLeft || '0');
    const y = r.top + iframe.clientTop + parseFloat(cs.paddingTop || '0');
    return {
      rect: { x, y, w: iframe.clientWidth, h: iframe.clientHeight },
      selector: frameSelector(iframe),
    };
  }

  private readonly onRuntimeMessage = (
    raw: unknown,
    _sender: unknown,
    sendResponse: (r: unknown) => void,
  ) => {
    const parsed = BackgroundToContentSchema.safeParse(raw);
    if (!parsed.success) return false;
    const msg = parsed.data;
    if (msg.type === 'state') {
      this.pushed = true;
      this.apply(msg.state);
      return false;
    }
    if (msg.type === 'flush') {
      // Reply with the pending typing instead of sending it, so the background can place it
      // before anything that happened in the tab the user switched to.
      const active = this.activeElementDeep();
      const event = this.recording && active ? this.takeTyping(active) : undefined;
      sendResponse({ event: event ?? null });
      return false;
    }
    if (msg.type === 'observe') {
      if (this.isTop && this.recording) this.observeNow(msg.observeId);
      return false;
    }
    if (msg.type === 'iframe-geometry') {
      void this.geometry(msg.token).then(sendResponse);
      return true;
    }
    // overlays
    if (!this.controller) {
      sendResponse({ ok: true });
      return false;
    }
    if (msg.visible) {
      this.controller.release();
      sendResponse({ ok: true });
      return false;
    }
    if (this.outline) this.outline.style.display = 'none';
    void this.controller.hideFor().then(() => sendResponse({ ok: true }));
    return true;
  };
}

export function formatKey(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Win');
  if (e.altKey) parts.push('Alt');
  const hasMods = parts.length > 0;
  if (e.shiftKey && (hasMods || e.key.length > 1)) parts.push('Shift');
  const key = KEY_NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  parts.push(key);
  return parts.join('+');
}
