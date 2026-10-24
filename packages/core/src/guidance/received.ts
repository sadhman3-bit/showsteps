// H4: guides from someone else (an imported file, or a team-folder guide another person saved
// last). Run for me shows what such a guide does before its first run, and acts on it only after
// the person ticks that they checked it.
import { needsConfirm } from '../agent/confirm.js';
import { toPlainText } from '../richText.js';
import type { Guide, Step } from '../schema.js';
import { guideSteps, planGuideStep } from './plan.js';

/** Where a received guide came from. */
export type ReceivedFrom = 'import' | 'shared-folder';

/** What a received guide does, for the "From someone else" panel. */
export interface ReceivedSummary {
  /** Hosts of its web steps, in order of first use. */
  sites: string[];
  /** Fixed values it types or chooses that the person didn't enter (step number, field, value). */
  typed: { step: number; field: string; value: string }[];
  /** Attach steps: whose file goes where (`from` is undefined for "the latest download"). */
  attaches: { step: number; from?: string; to: string }[];
  /** Steps Run for me stops at for the person, and why. */
  stops: { step: number; title: string; why: 'confirm' | 'person' }[];
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};
const short = (s: string) => (s.length > 80 ? `${s.slice(0, 79)}…` : s);

/** The guide marked as received, now (`file`: the imported file's name). */
export function markReceived(guide: Guide, from: ReceivedFrom, at: string, file?: string): Guide {
  return { ...guide, received: { at, from, ...(file ? { file: file.slice(0, 255) } : {}) } };
}

/** "Trust this guide": the mark comes off, so Run for me no longer asks first. */
export function trustGuide(guide: Guide): Guide {
  const { received: _r, ...rest } = guide;
  return rest;
}

/** Every step that should ask before an action that can't be undone does (import re-arms them). */
export function rearmConfirms(guide: Guide): Guide {
  return {
    ...guide,
    blocks: guide.blocks.map((b) =>
      b.kind === 'step' && !b.agent.confirm && needsConfirm(b)
        ? { ...b, agent: { ...b.agent, confirm: true } }
        : b,
    ),
  };
}

export function receivedSummary(guide: Guide): ReceivedSummary {
  const steps = guideSteps(guide);
  const hostFor = (s: Step | undefined) => (s && s.app.kind === 'web' ? hostOf(s.app.url) : '');
  const sites: string[] = [];
  const out: ReceivedSummary = { sites, typed: [], attaches: [], stops: [] };
  steps.forEach((s, i) => {
    const n = i + 1;
    const host = hostFor(s);
    if (host && !sites.includes(host)) sites.push(host);
    const plan = planGuideStep(guide, s);
    const input = s.input;
    if (
      plan.kind === 'act' &&
      input &&
      !input.sensitive &&
      input.mode !== 'ask' &&
      !input.variable &&
      input.value
    )
      out.typed.push({
        step: n,
        field: short(s.target?.label ?? s.target?.name ?? toPlainText(s.human.title)),
        value: short(input.value),
      });
    if (plan.kind === 'attach') {
      const source =
        plan.from.download === 'latest'
          ? undefined
          : steps.find((x) => x.id === plan.from.download);
      const from = hostFor(source);
      out.attaches.push({ step: n, ...(from ? { from } : {}), to: host });
    }
    if (s.agent.confirm)
      out.stops.push({ step: n, title: toPlainText(s.human.title), why: 'confirm' });
    else if (plan.kind === 'manual')
      out.stops.push({ step: n, title: toPlainText(s.human.title), why: 'person' });
  });
  return out;
}
