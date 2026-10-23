// Editor helpers for upload steps that attach a file this run downloaded (1.2).
import { updateStep } from '../editor/ops.js';
import type { Guide, Step } from '../schema.js';
import { guideSteps, type AttachSource } from './plan.js';

const DOWNLOAD_WORDS = /\b(download|export)/i;
const FILE_TYPES = /\b(pdf|csv|xlsx?|docx?|pptx?|zip|txt|json|xml)\b/i;

/**
 * A click on something that looks like a download: a link or button whose name, text or label
 * says Download or Export or names a file type, or whose selector has a `download` attribute.
 * (The attribute itself isn't recorded, so the words are what's left to go on.)
 */
export function looksLikeDownload(step: Step): boolean {
  if (step.app.kind !== 'web' || step.action !== 'click' || !step.target) return false;
  const t = step.target;
  const words = [t.name, t.text, t.label].filter(Boolean).join(' ');
  if (DOWNLOAD_WORDS.test(words) || FILE_TYPES.test(words)) return true;
  return t.selectors.some((s) => /\[download[\]=]/.test(s.value));
}

/** The nearest earlier step that looks like a download, for an upload step not yet set. */
export function suggestAttachSource(guide: Guide, step: Step): Step | undefined {
  if (step.action !== 'upload' || step.app.kind !== 'web' || step.input?.from) return undefined;
  const steps = guideSteps(guide);
  const at = steps.findIndex((s) => s.id === step.id);
  for (let i = at - 1; i >= 0; i--) if (looksLikeDownload(steps[i]!)) return steps[i];
  return undefined;
}

/** Set (or clear, with undefined) where an upload step's file comes from. */
export function setAttachSource(
  guide: Guide,
  stepId: string,
  from: AttachSource | undefined,
): Guide {
  return updateStep(guide, stepId, (s) => {
    if (s.action !== 'upload') return s;
    const { from: _old, ...input } = s.input ?? { mode: 'fixed' as const, sensitive: false };
    return { ...s, input: from ? { ...input, from } : input };
  });
}
