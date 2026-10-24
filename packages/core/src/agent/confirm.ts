// U5: steps whose control does something that cannot be undone get `agent.confirm`, so Run for
// me, the Playwright replay and agents pause for a person before doing them.
import type { Step, Target } from '../schema.js';

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

/**
 * H4: whether Run for me must stop before acting on the element it found, judged by the live
 * element rather than what the guide recorded: a control whose live name differs from the
 * recorded one and can't be undone stops. A step the person confirmed in this run goes on.
 * A schedule's approval (`approvedName`: the name recorded with it) holds only while the live
 * name is the same.
 */
export function liveNeedsConfirm(
  step: Step,
  live: Partial<Pick<Target, 'role' | 'name' | 'text'>>,
  run: { confirmed: boolean; approvedName?: string },
): boolean {
  if (run.confirmed) return false;
  const name = live.name ?? live.text;
  if (run.approvedName !== undefined) return (name ?? '') !== run.approvedName;
  if (!step.target) return false;
  // The element the guide recorded: its own confirm setting (re-armed on import) decides.
  if ((name ?? '') === (step.target.name ?? step.target.text ?? '')) return false;
  const role = live.role ?? step.target.role;
  return needsConfirm({
    ...step,
    target: {
      ...step.target,
      ...(role ? { role } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(live.text !== undefined ? { text: live.text } : {}),
    },
  });
}

/** Whether a recorded step should ask for confirmation before it is done. */
export function needsConfirm(step: Step): boolean {
  const t = step.target;
  if (!ACTIONS.has(step.action) || !t) return false;
  const role = t.role ?? t.uia?.controlType?.toLowerCase();
  if (role && !CONTROLS.has(role)) return false;
  return isIrreversibleName(t.name ?? t.text ?? t.uia?.name);
}
