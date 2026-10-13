import { tagOf } from './aria.js';

const SECRET_AUTOCOMPLETE = new Set(['current-password', 'new-password', 'one-time-code']);

/**
 * True for fields whose values ABCXYZ must never record: password inputs, and inputs whose
 * `autocomplete` names a password, one-time code or payment-card detail (cc-*).
 */
export function isSensitiveField(el: Element): boolean {
  const tag = tagOf(el);
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return false;
  if (tag === 'input' && (el.getAttribute('type') ?? '').toLowerCase() === 'password') return true;
  const tokens = (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/);
  return tokens.some((t) => SECRET_AUTOCOMPLETE.has(t) || t.startsWith('cc-'));
}

const TEXT_INPUT_TYPES = new Set([
  '',
  'text',
  'email',
  'search',
  'tel',
  'url',
  'number',
  'password',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
]);

/** Elements where typing produces a value (inputs, textareas, contenteditable). */
export function isTextEntry(el: Element): boolean {
  const tag = tagOf(el);
  if (tag === 'textarea') return true;
  if (tag === 'input') return TEXT_INPUT_TYPES.has((el.getAttribute('type') ?? '').toLowerCase());
  const ce = el.getAttribute('contenteditable');
  return ce === '' || ce === 'true' || ce === 'plaintext-only';
}
