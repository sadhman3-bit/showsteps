import { importGuideArchive, type GuideStore } from '@showsteps/core';

/** Sample guides bundled in public/samples (built by `pnpm make:samples`). */
export const SAMPLE_FILES = ['create-invoice.showsteps', 'monthly-report.showsteps'] as const;

/** Import the bundled sample guides into the library. Returns the new guide ids. */
export async function installSamples(store: GuideStore): Promise<string[]> {
  const ids: string[] = [];
  for (const file of SAMPLE_FILES) {
    const res = await fetch(browser.runtime.getURL(`/samples/${file}`));
    if (!res.ok) continue;
    const { guideId } = await importGuideArchive(store, new Uint8Array(await res.arrayBuffer()));
    ids.push(guideId);
  }
  return ids;
}
