import type { Guide, GuideStore } from '@showsteps/core';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Icon } from '../components/Icon.js';
import { strings } from '../strings.js';
import { GuideReader } from './GuideReader.js';

const s = strings.print;

/** X7: the reader laid out for paper, with a toolbar that is hidden when printing. */
export function PrintView({
  store,
  guideId,
  onBack,
}: {
  store: GuideStore;
  guideId: string;
  onBack: () => void;
}) {
  const [guide, setGuide] = useState<Guide | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    store
      .getGuide(guideId)
      .then((g) => live && setGuide(g ?? null))
      .catch(() => live && setGuide(null));
    return () => {
      live = false;
    };
  }, [store, guideId]);

  if (guide === undefined) return <main class="ss-print" aria-busy="true" />;
  return (
    <main class="ss-print">
      <div class="ss-print__bar">
        <Button variant="ghost" onClick={onBack}>
          <Icon name="back" /> {s.back}
        </Button>
        <Button variant="primary" onClick={() => window.print()} disabled={!guide}>
          {s.print}
        </Button>
        <span class="ss-muted">{s.hint}</span>
      </div>
      {guide ? (
        <GuideReader store={store} guide={guide} />
      ) : (
        <p class="ss-empty">{strings.guide.notFound}</p>
      )}
    </main>
  );
}
