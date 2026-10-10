import type { Guide, GuideStore } from '@trailmark/core';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Icon } from '../components/Icon.js';
import { ShareDialog } from '../export/ShareDialog.js';
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
  focusStepId?: string;
  /** Build a shareable link to a step; enables "copy link" buttons. */
  stepLink?: (guideId: string, stepId: string) => string;
  /** Bumped by the host when the library changes, to reload. */
  refreshKey?: number;
}

/** Read-only view of a stored guide (deep links land here). */
export function GuideView({
  store,
  guideId,
  onBack,
  onEdit,
  onPrint,
  focusStepId,
  stepLink,
  refreshKey,
}: GuideViewProps) {
  const [guide, setGuide] = useState<Guide | null | undefined>(undefined);
  const [copied, setCopied] = useState<string>();
  const [sharing, setSharing] = useState(false);

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

  if (guide === undefined) return <main class="tm-page" aria-busy="true" />;
  return (
    <main class="tm-page tm-guide">
      <nav class="tm-guide__nav">
        <Button variant="ghost" onClick={onBack}>
          <Icon name="back" /> {s.back}
        </Button>
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
    </main>
  );
}
