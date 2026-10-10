import {
  isBrowserProcess,
  isRemoteProcess,
  type AppContext,
  type CaptureEvent,
  type Target,
} from '@trailmark/core';
import type { PxRect, UiaElement } from './helper';

export const isRemote = isRemoteProcess;
export const isBrowser = isBrowserProcess;

/** UI Automation control types as ARIA-style roles (for step text and the agent view). */
const ROLES: Record<string, string> = {
  Button: 'button',
  SplitButton: 'button',
  Edit: 'textbox',
  Document: 'textbox',
  ComboBox: 'combobox',
  CheckBox: 'checkbox',
  RadioButton: 'radio',
  Hyperlink: 'link',
  MenuItem: 'menuitem',
  Menu: 'menu',
  MenuBar: 'menubar',
  ListItem: 'option',
  List: 'listbox',
  TabItem: 'tab',
  TreeItem: 'treeitem',
  DataItem: 'row',
  Slider: 'slider',
  Spinner: 'spinbutton',
  Text: 'text',
  Image: 'img',
  Window: 'window',
  Pane: 'pane',
  ToolBar: 'toolbar',
  HeaderItem: 'columnheader',
};

/** The app context of a desktop step. */
export function desktopApp(el: Pick<UiaElement, 'processName' | 'windowTitle'>): AppContext {
  return { kind: 'desktop', processName: el.processName, windowTitle: el.windowTitle };
}

/** Where an element is, relative to the screenshot (physical pixels; the clicked window). */
function relative(rect: PxRect, monitor: PxRect): PxRect {
  return { x: rect.x - monitor.x, y: rect.y - monitor.y, w: rect.w, h: rect.h };
}

/**
 * A recorded target from UI Automation. Selectors: automation id first (stable across runs),
 * then name + control type, then the ancestor path. `bbox` and `point` are in the screenshot's
 * physical pixels.
 */
export function desktopTarget(
  el: UiaElement,
  monitor: PxRect,
  point: { x: number; y: number },
): Target {
  const selectors: Target['selectors'] = [];
  if (el.automationId && !/^\d+$/.test(el.automationId))
    selectors.push({ type: 'uia', value: `id=${el.automationId}`, score: 0.95 });
  if (el.name) selectors.push({ type: 'uia', value: `${el.controlType}:${el.name}`, score: 0.85 });
  if (el.automationId && /^\d+$/.test(el.automationId))
    selectors.push({ type: 'uia', value: `id=${el.automationId}`, score: 0.6 });
  if (el.path.length)
    selectors.push({ type: 'uia', value: `path=${el.path.join(' > ')}`, score: 0.4 });
  const role = ROLES[el.controlType];
  return {
    ...(role ? { role } : {}),
    ...(el.name ? { name: el.name } : {}),
    selectors,
    uia: {
      ...(el.automationId ? { automationId: el.automationId } : {}),
      ...(el.name ? { name: el.name } : {}),
      controlType: el.controlType,
      ...(el.className ? { className: el.className } : {}),
      windowTitle: el.windowTitle,
      processName: el.processName,
      path: el.path,
    },
    bbox: relative(el.rect, monitor),
    point: { x: point.x - monitor.x, y: point.y - monitor.y },
  };
}

/** Same element within a capture (process + automation id or path). */
export function elementKey(el: UiaElement): string {
  return `${el.pid}:${el.automationId || el.path.join('/')}`;
}

const TOGGLES: Record<string, 'checkbox' | 'radio'> = {
  CheckBox: 'checkbox',
  RadioButton: 'radio',
};

/** A mouse press as a capture event (clicks on checkboxes record the state after the click). */
export function clickEvent(
  el: UiaElement,
  button: 'left' | 'right',
  monitor: PxRect,
  point: { x: number; y: number },
  at: string,
  checkedBefore?: boolean,
): CaptureEvent {
  const toggle = TOGGLES[el.controlType];
  return {
    kind: 'click',
    button,
    target: desktopTarget(el, monitor, point),
    element: elementKey(el),
    app: desktopApp(el),
    at,
    source: 'desktop',
    ...(toggle && button === 'left' && checkedBefore !== undefined
      ? { toggle: { role: toggle, checked: !checkedBefore } }
      : {}),
  };
}

/**
 * Committed typing. The value is read from the control once typing ends (never keystroke by
 * keystroke), and never from password controls.
 */
export function typeEvent(el: UiaElement, monitor: PxRect, at: string): CaptureEvent {
  const sensitive = el.isPassword;
  const raw = sensitive ? undefined : (el.value ?? undefined);
  const value = raw?.replace(/\r\n/g, '\n').replace(/\s+$/, '');
  const centre = { x: el.rect.x + el.rect.w / 2, y: el.rect.y + el.rect.h / 2 };
  return {
    kind: 'type',
    target: desktopTarget(el, monitor, centre),
    element: elementKey(el),
    app: desktopApp(el),
    at,
    source: 'desktop',
    sensitive,
    ...(value ? { value } : {}),
  };
}

export function keyEvent(
  key: string,
  el: UiaElement | undefined,
  monitor: PxRect,
  at: string,
): CaptureEvent {
  return {
    kind: 'key',
    key,
    at,
    source: 'desktop',
    app: el ? desktopApp(el) : { kind: 'desktop', processName: '', windowTitle: '' },
    ...(el
      ? {
          target: desktopTarget(el, monitor, {
            x: el.rect.x + el.rect.w / 2,
            y: el.rect.y + el.rect.h / 2,
          }),
          element: elementKey(el),
        }
      : {}),
  };
}

/** Multi-line controls, where Enter adds a line instead of finishing the entry. */
export function isMultiline(el: UiaElement): boolean {
  return el.controlType === 'Document';
}
