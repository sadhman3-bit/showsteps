import {
  thumbNameFor,
  updateStep,
  withOriginal,
  type GuideStore,
  type Step,
} from '@showsteps/core';
import type { EncodedShot } from './shots';

/**
 * Replace a step's screenshot with a fresh capture. The first capture is kept as the original
 * (for "Reset to original"). Blurs stay (they protect data); the highlight box and annotations
 * are cleared because their positions belonged to the old picture.
 */
export async function recaptureStep(
  store: GuideStore,
  guideId: string,
  stepId: string,
  capture: () => Promise<string>,
  encode: (dataUrl: string) => Promise<EncodedShot>,
  dpr = 1,
): Promise<void> {
  const guide = await store.getGuide(guideId);
  const step = guide?.blocks.find((b): b is Step => b.kind === 'step' && b.id === stepId);
  if (!guide || !step) throw new Error('That step no longer exists.');
  const encoded = await encode(await capture());
  const name = `${stepId}-${Date.now().toString(36)}.${encoded.ext}`;
  await store.putImage(guideId, name, encoded.full);
  await store.putImage(guideId, thumbNameFor(name), encoded.thumb);
  const next = updateStep(guide, stepId, (s) => {
    const kept = withOriginal(s);
    const human: Step['human'] = {
      ...kept.human,
      screenshot: { file: `img/${name}`, width: encoded.width, height: encoded.height, dpr },
      annotations: [],
    };
    delete human.actionBox;
    return { ...kept, human };
  });
  await store.saveGuide(next, { snapshot: true });
}
