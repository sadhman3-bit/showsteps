import type { Expectation, Step } from '../schema.js';
import { findTarget, type MatchOptions } from './match.js';
import { normalizeText, visibleText } from './aria.js';

/**
 * Run for me (G6): perform a recorded step on an element with synthetic DOM events. Works for
 * ordinary web apps; pages that only trust real input need the person to act (the runner
 * then waits, as for a manual step). Everything goes through the element's own window.
 */

type Win = Window & typeof globalThis;

function winOf(el: Element): Win {
  const w = el.ownerDocument.defaultView;
  if (!w) throw new Error('element has no window');
  return w as Win;
}

function centre(el: Element): { clientX: number; clientY: number } {
  const r = el.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
}

function mouse(el: Element, type: string, button = 0): boolean {
  const w = winOf(el);
  const pointer = type.startsWith('pointer');
  const Ctor = pointer && w.PointerEvent ? w.PointerEvent : w.MouseEvent;
  return el.dispatchEvent(
    new Ctor(type, {
      bubbles: !['mouseenter', 'pointerenter'].includes(type),
      cancelable: true,
      composed: true,
      view: w,
      button,
      buttons: type.endsWith('down') ? (button === 2 ? 2 : 1) : 0,
      ...(pointer ? { pointerId: 1, pointerType: 'mouse', isPrimary: true } : {}),
      ...centre(el),
    }),
  );
}

function focus(el: Element): void {
  const w = winOf(el);
  if (el instanceof w.HTMLElement || el instanceof w.SVGElement) el.focus({ preventScroll: true });
}

function press(el: Element, button = 0): void {
  mouse(el, 'pointerdown', button);
  mouse(el, 'mousedown', button);
  focus(el);
  mouse(el, 'pointerup', button);
  mouse(el, 'mouseup', button);
}

function click(el: Element): void {
  press(el);
  const w = winOf(el);
  // HTMLElement.click() also runs activation behaviour (links, labels, checkboxes, submit).
  if (el instanceof w.HTMLElement) el.click();
  else mouse(el, 'click');
}

const isTag = (el: Element, ...tags: string[]) => tags.includes(el.tagName.toLowerCase());

/** The form control to type into: the element itself or the first control inside it. */
function editable(el: Element): Element {
  if (isTag(el, 'input', 'textarea', 'select') || (el as HTMLElement).isContentEditable) return el;
  return el.querySelector('input, textarea, select, [contenteditable="true"]') ?? el;
}

function fire(el: Element, type: 'input' | 'change'): void {
  const w = winOf(el);
  const ev =
    type === 'input' && w.InputEvent
      ? new w.InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' })
      : new w.Event(type, { bubbles: true, composed: true });
  el.dispatchEvent(ev);
}

/** Set a control's value the way frameworks notice (the native setter, then input + change). */
export function setValue(target: Element, value: string): void {
  const el = editable(target);
  const w = winOf(el);
  focus(el);
  if (el instanceof w.HTMLInputElement || el instanceof w.HTMLTextAreaElement) {
    const proto = el instanceof w.HTMLInputElement ? w.HTMLInputElement : w.HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  } else if ((el as HTMLElement).isContentEditable) {
    el.textContent = value;
  }
  fire(el, 'input');
  fire(el, 'change');
}

/** Choose an option by its text (what capture records) or its value. */
export function selectOption(target: Element, value: string): boolean {
  const el = editable(target);
  const w = winOf(el);
  if (!(el instanceof w.HTMLSelectElement)) return false;
  const wanted = value.trim();
  const i = Array.from(el.options).findIndex(
    (o) => o.text.trim() === wanted || o.value === wanted || (o.label ?? '').trim() === wanted,
  );
  if (i < 0) return false;
  focus(el);
  el.selectedIndex = i;
  fire(el, 'input');
  fire(el, 'change');
  return true;
}

function isChecked(el: Element): boolean {
  const w = winOf(el);
  const input = el instanceof w.HTMLInputElement ? el : el.querySelector('input');
  if (input && (input.type === 'checkbox' || input.type === 'radio')) return input.checked;
  return el.getAttribute('aria-checked') === 'true';
}

const KEY_ALIASES: Record<string, string> = {
  Esc: 'Escape',
  Space: ' ',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
};

/** Press a recorded key such as "Enter" or "Ctrl+S". */
export function pressKey(el: Element, combo: string): void {
  const w = winOf(el);
  const parts = combo.split('+');
  const key = KEY_ALIASES[parts.at(-1) ?? ''] ?? parts.at(-1) ?? '';
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));
  const init = {
    key,
    bubbles: true,
    cancelable: true,
    composed: true,
    ctrlKey: mods.has('ctrl'),
    shiftKey: mods.has('shift'),
    altKey: mods.has('alt'),
    metaKey: mods.has('meta') || mods.has('cmd'),
  };
  const proceed = el.dispatchEvent(new w.KeyboardEvent('keydown', init));
  el.dispatchEvent(new w.KeyboardEvent('keyup', init));
  if (
    proceed &&
    key === 'Enter' &&
    mods.size === 0 &&
    el instanceof w.HTMLInputElement &&
    el.form
  ) {
    el.form.requestSubmit();
  }
}

/**
 * Whether `performStep` can do this step here. Checked before acting, because the action may
 * replace the page and leave no chance to report back.
 */
export function canPerform(el: Element, step: Step, value: string | undefined): boolean {
  switch (step.action) {
    case 'click':
    case 'double_click':
    case 'right_click':
    case 'hover':
    case 'scroll':
    case 'check':
    case 'key':
      return true;
    case 'type':
      return value !== undefined;
    case 'select': {
      if (value === undefined) return false;
      const control = editable(el);
      if (control.tagName.toLowerCase() !== 'select') return true;
      const wanted = value.trim();
      return Array.from((control as HTMLSelectElement).options).some(
        (o) => o.text.trim() === wanted || o.value === wanted,
      );
    }
    default:
      return false;
  }
}

/**
 * Perform `step` on `el`. Returns false when the step cannot be done with page events (the
 * option is missing, or the action needs a person).
 */
export function performStep(el: Element, step: Step, value: string | undefined): boolean {
  switch (step.action) {
    case 'click':
      click(el);
      return true;
    case 'double_click':
      click(el);
      click(el);
      mouse(el, 'dblclick');
      return true;
    case 'right_click':
      press(el, 2);
      mouse(el, 'contextmenu', 2);
      return true;
    case 'hover':
      mouse(el, 'pointerover');
      mouse(el, 'pointerenter');
      mouse(el, 'mouseover');
      mouse(el, 'mouseenter');
      return true;
    case 'scroll':
      el.scrollIntoView({ block: 'center' });
      return true;
    case 'type':
      if (value === undefined) return false;
      setValue(el, value);
      return true;
    case 'select':
      if (value === undefined) return false;
      if (selectOption(el, value)) return true;
      click(el); // a custom drop-down: open it; the next step picks the option
      return true;
    case 'check': {
      const want = (value ?? 'true') === 'true';
      if (isChecked(el) !== want) click(el);
      return true;
    }
    case 'key':
      pressKey(el, step.key ?? 'Enter');
      return true;
    default:
      return false;
  }
}

/** Which expectations do not hold on this page right now (Run for me stops on the first). */
/** `matches` is a regular expression (as captured); plain text if it is not a valid one. */
export function urlMatches(url: string, matches: string): boolean {
  try {
    return new RegExp(matches).test(url);
  } catch {
    return url.includes(matches);
  }
}

export function failedExpectations(
  doc: Document,
  url: string,
  expectations: Expectation[] | undefined,
  opts: MatchOptions = {},
): Expectation[] {
  return (expectations ?? []).filter((e) => {
    switch (e.type) {
      case 'url':
        return !urlMatches(url, e.matches);
      case 'visible':
        return !findTarget(doc, e.target, opts);
      case 'hidden':
        return !!findTarget(doc, e.target, opts);
      case 'text':
        return !(doc.body ? visibleText(doc.body) : '').includes(normalizeText(e.contains));
      case 'window':
        return false; // desktop only
    }
  });
}
