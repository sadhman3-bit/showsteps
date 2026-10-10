import {
  END_OF_GUIDE,
  nowIso,
  parseAnalytics,
  recordView,
  type Guide,
  type GuideStore,
} from '@trailmark/core';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Icon } from '../components/Icon.js';
import { ShareDialog } from '../export/ShareDialog.js';
import { CommentBox, useComments } from '../guidance/Comments.js';
import { RunDialog, type RunSpeed } from '../guidance/RunDialog.js';
import { strings } from '../strings.js';
import { GuideReader } from './GuideReader.js';

const s = strings.guide;

export interface GuideViewProps {
  store: GuideStore;
  guideId: string;
  onBack: () => void;
  onEdit?: () => void;
  /** Open the print view; enables Print in the Share dialog. */
  onPrint?: () => void;
  /** Start Guide Me (G1); called inside the click. */
  onGuideMe?: (guide: Guide) => void;
  /** Start Run for me (G6) with the values asked for at the start. */
  onRunForMe?: (
    guide: Guide,
    opts: { values: Record<string, string>; speed: RunSpeed; stepThrough: boolean },
  ) => void;
  /** The person viewing: enables comments (L4) and counts the view (L5). */
  user?: string;
  focusStepId?: string;
  /** Build a shareable link to a step; enables "copy link" buttons. */
  stepLink?: (guideId: string, stepId: string) => string;
  /** Bumped by the host when the library changes, to reload. */
  refreshKey?: number;
}

/** Count one view in the viewer's own analytics sidecar. */
async function countView(store: GuideStore, guideId: string, user: string): Promise<void> {
  const current = parseAnalytics(await store.readSidecar(guideId, 'analytics', user));
  await store.writeSidecar(guideId, 'analytics', user, recordView(current, nowIso()));
}

/** Read-only view of a stored guide (deep links land here). */
export function GuideView({
  store,
  guideId,
  onBack,
  onEdit,
  onPrint,
  onGuideMe,
  onRunForMe,
  user,
  focusStepId,
  stepLink,
  refreshKey,
}: GuideViewProps) {
  const [guide, setGuide] = useState<Guide | null | undefined>(undefined);
  const [copied, setCopied] = useState<string>();
  const [sharing, setSharing] = useState(false);
  const [running, setRunning] = useState(false);
  const comments = useComments(store, guideId, user ?? '');

  useEffect(() => {
    let live = true;
    store
      .getGuide(guideId)
      .then((g) => live && setGuide(g ?? null))
      .catch(() => live && setGuide(null));
    return () => {
      live = false;
    };
  }, [store, guideId, refreshKey]);

  useEffect(() => {
    if (user) void countView(store, guideId, user).catch(() => undefined);
  }, [store, guideId, user]);

  if (guide === undefined) return <main class="tm-page" aria-busy="true" />;
  const hasSteps = !!guide?.blocks.some((b) => b.kind === 'step');
  return (
    <main class="tm-page tm-guide">
      <nav class="tm-guide__nav">
        <Button variant="ghost" onClick={onBack}>
          <Icon name="back" /> {s.back}
        </Button>
        {guide && hasSteps && onGuideMe ? (
          <Button
            variant="primary"
            title={strings.guidance.guideMeHint}
            onClick={() => onGuideMe(guide)}
          >
            {strings.guidance.guideMe}
          </Button>
        ) : null}
        {guide && hasSteps && onRunForMe ? (
          <Button title={strings.guidance.runForMeHint} onClick={() => setRunning(true)}>
            {strings.guidance.runForMe}
          </Button>
        ) : null}
        {guide ? <Button onClick={() => setSharing(true)}>{strings.share.button}</Button> : null}
        {guide && onEdit ? <Button onClick={onEdit}>{strings.editor.edit}</Button> : null}
      </nav>
      {guide === null ? (
        <p class="tm-empty">{s.notFound}</p>
      ) : (
        <GuideReader
          store={store}
          guide={guide}
          {...(focusStepId ? { focusStepId } : {})}
          {...(copied ? { copiedStepId: copied } : {})}
          {...(stepLink
            ? {
                onCopyLink: (stepId: string) => {
                  void navigator.clipboard
                    .writeText(stepLink(guide.id, stepId))
                    .then(() => setCopied(stepId));
                },
              }
            : {})}
          {...(user
            ? {
                renderAfter: (blockId: string) => <CommentBox api={comments} blockId={blockId} />,
                footer: (
                  <section class="tm-social__end" aria-labelledby="tm-end-h">
                    <h2 id="tm-end-h">{strings.social.endHeading}</h2>
                    <CommentBox api={comments} blockId={END_OF_GUIDE} />
                  </section>
                ),
              }
            : {})}
        />
      )}
      {guide && sharing ? (
        <ShareDialog
          store={store}
          guide={guide}
          onClose={() => setSharing(false)}
          {...(onPrint ? { onPrint } : {})}
        />
      ) : null}
      {guide && running && onRunForMe ? (
        <RunDialog
          guide={guide}
          onClose={() => setRunning(false)}
          onStart={(opts) => {
            setRunning(false);
            onRunForMe(guide, opts);
          }}
        />
      ) : null}
    </main>
  );
}
