import type { Guide, GuideSummary } from '@showsteps/core';
import { IconButton, RunDialog, strings, type RunOptions } from '@showsteps/ui';
import { useState } from 'preact/hooks';
import { getStore, startError, startGuide } from '../../lib/client';

const g = strings.guidance;

/**
 * Guide Me and Run for me from the side panel's lists (1.2): Guide Me starts inside the click;
 * Run for me opens its dialog (values, speed, step-through) first. `tab` is the page to start
 * on, when known.
 */
export function useStartGuide(tab?: { id?: number; windowId?: number }) {
  const [error, setError] = useState('');
  const [runFor, setRunFor] = useState<Guide | null>(null);
  const begin = (guideId: string, mode: 'guide' | 'run', run?: RunOptions) => {
    setError('');
    void startGuide({
      guideId,
      mode,
      ...(tab?.id !== undefined ? { tabId: tab.id } : {}),
      ...(tab?.windowId !== undefined ? { windowId: tab.windowId } : {}),
      ...(run ?? {}),
    }).then((err) => setError(err ? startError(err) : ''));
  };
  return {
    error,
    guideMe: (guideId: string) => begin(guideId, 'guide'),
    runForMe: (guideId: string) =>
      void getStore()
        .getGuide(guideId)
        .then((guide) => guide && setRunFor(guide)),
    runDialog: runFor ? (
      <RunDialog
        guide={runFor}
        onTrust={(trusted) => getStore().saveGuide(trusted)}
        onClose={() => setRunFor(null)}
        onStart={(opts) => {
          setRunFor(null);
          begin(runFor.id, 'run', opts);
        }}
      />
    ) : null,
  };
}

/** Guide Me and Run for me icon buttons for one listed guide. */
export function GuideActions(props: {
  guide: Pick<GuideSummary, 'title' | 'apps'>;
  onGuideMe: () => void;
  onRunForMe: () => void;
}) {
  const web = props.guide.apps.some((a) => a.kind === 'web');
  const off = web ? {} : { disabled: true, title: g.noWebSteps };
  return (
    <span class="ss-guidelist__actions">
      <IconButton
        icon="trail"
        size="sm"
        label={g.guideMeFor(props.guide.title)}
        {...off}
        onClick={props.onGuideMe}
      />
      <IconButton
        icon="play"
        size="sm"
        label={g.runForMeFor(props.guide.title)}
        {...off}
        onClick={props.onRunForMe}
      />
    </span>
  );
}
