// Run for me attaches a downloaded file (1.2): find the page's file field for an upload step and
// set the file on it, through the element's own window (core never touches DOM globals).
import { deepElements } from './traverse.js';

type Win = Window & typeof globalThis;

function winOf(el: Element): Win | undefined {
  return (el.ownerDocument.defaultView ?? undefined) as Win | undefined;
}

function isFileInput(el: Element | null | undefined): el is HTMLInputElement {
  const w = el ? winOf(el) : undefined;
  return !!el && !!w && el instanceof w.HTMLInputElement && el.type === 'file';
}

const only = (els: Element[]): HTMLInputElement | undefined => {
  const inputs = els.filter(isFileInput);
  return inputs.length === 1 ? inputs[0] : undefined;
};

/**
 * The file field an upload step means: the target itself, the input a `<label>` points at, the
 * one file input inside the target, or the only one in the same form, dialog or document.
 * Undefined when there is none, or more than one to choose from.
 */
export function fileInputFor(target: Element): HTMLInputElement | undefined {
  if (isFileInput(target)) return target;
  const w = winOf(target);
  if (w && target instanceof w.HTMLLabelElement && isFileInput(target.control))
    return target.control;
  const inside = Array.from(target.querySelectorAll('input[type="file"]'));
  if (inside.length) return only(inside);
  const scope = target.closest('form, dialog, [role="dialog"]');
  if (scope) {
    const near = only(Array.from(scope.querySelectorAll('input')));
    if (near) return near;
  }
  return only(deepElements(target.ownerDocument));
}

/** Whether a field's `accept` list takes a file (`.pdf`, `image/*`, `application/pdf`). */
export function acceptsFile(accept: string, name: string, type: string): boolean {
  const tokens = accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.length) return true;
  const lower = name.toLowerCase();
  const mime = type.toLowerCase();
  return tokens.some((t) =>
    t.startsWith('.')
      ? lower.endsWith(t)
      : t.endsWith('/*')
        ? !!mime && mime.startsWith(t.slice(0, -1))
        : mime === t,
  );
}

/** Why a file can't go in a field, or undefined when it can. */
export function attachProblem(input: HTMLInputElement, file: File): 'file-type' | undefined {
  if (input.disabled) return 'file-type';
  return acceptsFile(input.accept, file.name, file.type) ? undefined : 'file-type';
}

/** Put the file in the field and tell the page, as choosing it in the picker would. */
export function setInputFile(input: HTMLInputElement, file: File): void {
  const w = winOf(input);
  if (!w) return;
  const transfer = new w.DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new w.Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new w.Event('change', { bubbles: true, composed: true }));
}
