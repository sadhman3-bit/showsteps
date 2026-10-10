// U5: steps whose control does something that cannot be undone get `agent.confirm`, so Run for
// me, the Playwright replay and agents pause for a person before doing them.
import type { Step } from '../schema.js';

const IRREVERSIBLE =
  /\b(?:submit|send|delete|remove|approve|post|pay|publish|finali[sz]e|confirm)\b/i;
/** ARIA roles, and UI Automation control types in lower case. */
const CONTROLS = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemradio',
  'option',
  'tab',
  'hyperlink',
  'splitbutton',
]);
const ACTIONS = new Set<Step['action']>(['click', 'double_click', 'key']);

/** Whether the name of a control means an action that cannot be taken back. */
export function isIrreversibleName(name: string | undefined): boolean {
  return !!name && IRREVERSIBLE.test(name);
}

/** Whether a recorded step should ask for confirmation before it is done. */
export function needsConfirm(step: Step): boolean {
  const t = step.target;
  if (!ACTIONS.has(step.action) || !t) return false;
  const role = t.role ?? t.uia?.controlType?.toLowerCase();
  if (role && !CONTROLS.has(role)) return false;
  return isIrreversibleName(t.name ?? t.text ?? t.uia?.name);
}
