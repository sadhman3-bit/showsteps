// U7: agent self-check. A dry run of a guide in a new tab: every web step's page is opened and
// its element looked for and ringed, but nothing is clicked or typed. The report says per step
// whether the element was found, found among look-alikes (ambiguous) or missing.
import { guideSteps, planStep, type Guide, type Step } from '@showsteps/core';
import { frameFor, type GuidanceDeps } from './guidance';
import { ProbeReplySchema } from './guideMessages';

export type CheckStatus = 'found' | 'ambiguous' | 'missing' | 'skipped';

export interface StepCheck {
  stepId: string;
  number: number;
  status: CheckStatus;
  /** How the element was found (role and name, label, CSS…). */
  strategy?: string;
  confidence?: number;
  /** Why a step was skipped: in a desktop app, done by hand, no element details. */
  reason?: 'desktop' | 'manual' | 'no-target';
}

export type SelfCheckDeps = Pick<
  GuidanceDeps,
  'openTab' | 'navigate' | 'waitLoaded' | 'frames' | 'send' | 'sleep' | 'tabUrl'
>;

const PAGE_LOAD_TIMEOUT = 15_000;
/** How long to wait for an element (slow sections, scripts still rendering). */
const FIND_TIMEOUT = 3000;
/** How long each found element stays ringed before the next step. */
const SHOW_MS = 400;

const pageOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
};

function skipped(step: Step, number: number): StepCheck | undefined {
  const plan = planStep(step);
  if (plan.kind !== 'manual') return undefined;
  // Secrets and uploads still have an element to find; only nothing-to-find steps are skipped.
  if (plan.reason === 'secret' || plan.reason === 'upload') return undefined;
  return {
    stepId: step.id,
    number,
    status: 'skipped',
    reason:
      plan.reason === 'desktop' ? 'desktop' : plan.reason === 'no-target' ? 'no-target' : 'manual',
  };
}

export async function selfCheck(
  guide: Guide,
  deps: SelfCheckDeps,
  onStep: (check: StepCheck) => void = () => undefined,
): Promise<StepCheck[]> {
  const steps = guideSteps(guide);
  const first = steps.find((s) => s.app.kind === 'web');
  if (!first || first.app.kind !== 'web') {
    const all = steps.map(
      (s, i) =>
        skipped(s, i + 1) ?? {
          stepId: s.id,
          number: i + 1,
          status: 'skipped' as const,
          reason: 'desktop' as const,
        },
    );
    all.forEach(onStep);
    return all;
  }
  const tabId = await deps.openTab(first.app.url);
  const results: StepCheck[] = [];
  const report = (c: StepCheck) => {
    results.push(c);
    onStep(c);
  };
  try {
    await deps.waitLoaded(tabId, PAGE_LOAD_TIMEOUT);
    for (const [i, step] of steps.entries()) {
      const number = i + 1;
      const skip = skipped(step, number);
      if (skip) {
        report(skip);
        continue;
      }
      if (step.app.kind !== 'web') continue;
      // Open the step's page when the tab is somewhere else (the dry run cannot get there by
      // acting, so it goes straight to the recorded address).
      const here = await deps.tabUrl(tabId);
      if (!here || pageOf(here) !== pageOf(step.app.url)) {
        await deps.navigate(tabId, step.app.url);
        await deps.waitLoaded(tabId, PAGE_LOAD_TIMEOUT);
      }
      if (step.action === 'navigate') {
        report({ stepId: step.id, number, status: 'found', strategy: 'address' });
        continue;
      }
      let reply: ReturnType<typeof ProbeReplySchema.parse> | undefined;
      const deadline = Date.now() + FIND_TIMEOUT + 2000;
      while (!reply && Date.now() < deadline) {
        const frameId = frameFor(await deps.frames(tabId).catch(() => []), step);
        if (frameId !== undefined) {
          const parsed = ProbeReplySchema.safeParse(
            await deps
              .send(tabId, { type: 'guide-probe', step, timeoutMs: FIND_TIMEOUT }, frameId)
              .catch(() => undefined),
          );
          if (parsed.success) reply = parsed.data;
        }
        if (!reply) await deps.sleep(250);
      }
      report({
        stepId: step.id,
        number,
        status: reply?.status ?? 'missing',
        ...(reply?.strategy ? { strategy: reply.strategy } : {}),
        ...(reply?.confidence !== undefined ? { confidence: reply.confidence } : {}),
      });
      if (reply && reply.status !== 'missing') await deps.sleep(SHOW_MS);
    }
  } finally {
    await deps.send(tabId, { type: 'guide-clear' }).catch(() => undefined);
  }
  return results;
}
