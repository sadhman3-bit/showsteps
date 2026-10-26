import { tagOf } from './aria.js';

const SECRET_AUTOCOMPLETE = new Set(['current-password', 'new-password', 'one-time-code']);

/** H6: names of fields that hold secrets even without `type="password"` or `autocomplete`. */
const SECRET_NAME =
  /password|passcode|passwd|\bpin\b|one.?time|otp|cvv|cvc|security code|card number|tfn|tax file|bsb|account number/i;

/** The words that name an input: its name, id, aria-label, label text and placeholder. */
function inputNames(el: Element): string[] {
  const labels = Array.from((el as HTMLInputElement).labels ?? []).map((l) => l.textContent ?? '');
  return [
    el.getAttribute('name'),
    el.getAttribute('id'),
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    ...labels,
  ].filter((n): n is string => !!n);
}

/** Whether an input's name, id, label or placeholder says it holds a secret (H6). */
export function hasSecretName(el: Element): boolean {
  return tagOf(el) === 'input' && inputNames(el).some((n) => SECRET_NAME.test(n));
}

/**
 * True for fields whose values ShowSteps must never record: password inputs, inputs whose
 * `autocomplete` names a password, one-time code or payment-card detail (cc-*), and inputs whose
 * name, id, label or placeholder names a secret (PIN, CVV, account number…).
 */
export function isSensitiveField(el: Element): boolean {
  const tag = tagOf(el);
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return false;
  if (tag === 'input' && (el.getAttribute('type') ?? '').toLowerCase() === 'password') return true;
  const tokens = (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/);
  if (tokens.some((t) => SECRET_AUTOCOMPLETE.has(t) || t.startsWith('cc-'))) return true;
  return hasSecretName(el);
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
