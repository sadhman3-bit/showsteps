import { normalize } from './richText.js';
import type { RichText, Span, Step, Target } from './schema.js';

const MAX_NAME = 60;

/** Short descriptions used when an element has no usable name. */
const ROLE_PHRASES: Record<string, string> = {
  button: 'the button',
  link: 'the link',
  textbox: 'the text box',
  searchbox: 'the search box',
  combobox: 'the drop-down',
  listbox: 'the list',
  option: 'the option',
  checkbox: 'the checkbox',
  radio: 'the option',
  switch: 'the switch',
  tab: 'the tab',
  menuitem: 'the menu item',
  menu: 'the menu',
  img: 'the image',
  heading: 'the heading',
  row: 'the row',
  cell: 'the cell',
  gridcell: 'the cell',
  dialog: 'the dialog',
  slider: 'the slider',
  spinbutton: 'the number box',
  treeitem: 'the item',
  document: 'the document',
  window: 'the window',
};

export function cleanName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > MAX_NAME ? `${text.slice(0, MAX_NAME - 1).trimEnd()}…` : text;
}

/** The best human label for a target: name, label, text, placeholder, in that order. */
export function targetLabel(target: Partial<Target> | undefined): string | undefined {
  if (!target) return undefined;
  return (
    cleanName(target.name) ??
    cleanName(target.label) ??
    cleanName(target.text) ??
    cleanName(target.placeholder) ??
    cleanName(target.uia?.name)
  );
}

/** Span for a target: its bold label, or a plain role phrase such as "the search box". */
function targetSpan(target: Partial<Target> | undefined, fallback = 'the highlighted area'): Span {
  const label = targetLabel(target);
  if (label) return { text: label, bold: true };
  const role = target?.role ?? target?.uia?.controlType?.toLowerCase();
  return { text: (role && ROLE_PHRASES[role]) ?? fallback };
}

const b = (text: string): Span => ({ text, bold: true });
const t = (text: string): Span => ({ text });

function doc(...spans: Span[]): RichText {
  return normalize({ spans });
}

function looksLikePassword(target: Partial<Target> | undefined): boolean {
  const label = targetLabel(target) ?? '';
  return /pass(word|code|phrase)|\bpin\b/i.test(label);
}

/** What was typed or chosen, as shown in the title: a {{variable}} or the literal value. */
function valueText(step: Step): string | undefined {
  if (!step.input || step.input.sensitive) return undefined;
  if (step.input.variable) return `{{${step.input.variable}}}`;
  return cleanName(step.input.value);
}

function fileName(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return cleanName(path.split(/[\\/]/).pop());
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return (u.host || u.href).replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Deterministic title for a step. Never includes sensitive values. */
export function writeStepTitle(step: Step): RichText {
  const target = step.target;
  switch (step.action) {
    case 'click':
      return doc(t('Click '), targetSpan(target));
    case 'double_click':
      return doc(t('Double-click '), targetSpan(target));
    case 'right_click':
      return doc(t('Right-click '), targetSpan(target));
    case 'hover':
      return doc(t('Hover over '), targetSpan(target));
    case 'type': {
      if (step.input?.sensitive) {
        if (looksLikePassword(target)) return doc(t('Enter your password'));
        return doc(t('Enter '), targetSpan(target, 'the protected field'));
      }
      const value = valueText(step);
      if (!value) return doc(t('Fill in '), targetSpan(target, 'the field'));
      return doc(t('Type '), b(value), t(' into '), targetSpan(target, 'the field'));
    }
    case 'select': {
      const value = valueText(step);
      if (!value) return doc(t('Choose an option from '), targetSpan(target, 'the list'));
      return doc(t('Select '), b(value), t(' from '), targetSpan(target, 'the list'));
    }
    case 'check': {
      if (target?.role === 'radio') return doc(t('Select '), targetSpan(target));
      const unchecked = step.input?.value === 'false';
      return doc(t(unchecked ? 'Uncheck ' : 'Check '), targetSpan(target));
    }
    case 'key':
      return step.key ? doc(t('Press '), b(step.key)) : doc(t('Press a key'));
    case 'navigate': {
      if (step.app.kind === 'web') return doc(t('Go to '), b(hostOf(step.app.url)));
      return doc(t('Open '), b(step.app.windowTitle || step.app.processName));
    }
    case 'scroll':
      return target ? doc(t('Scroll to '), targetSpan(target)) : doc(t('Scroll down the page'));
    case 'wait':
      return target
        ? doc(t('Wait for '), targetSpan(target), t(' to appear'))
        : doc(t('Wait for the page to finish loading'));
    case 'upload': {
      const name = step.input?.variable
        ? `{{${step.input.variable}}}`
        : fileName(step.input?.value);
      return name
        ? doc(t('Upload '), b(name))
        : doc(t('Upload a file to '), targetSpan(target, 'the page'));
    }
    case 'manual':
      return doc(t('Complete this step manually'));
  }
}
