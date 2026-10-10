import type { Guide, GuideStore } from '@trailmark/core';
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

  if (guide === undefined) return <main class="tm-print" aria-busy="true" />;
  return (
    <main class="tm-print">
      <div class="tm-print__bar">
        <Button variant="ghost" onClick={onBack}>
          <Icon name="back" /> {s.back}
        </Button>
        <Button variant="primary" onClick={() => window.print()} disabled={!guide}>
          {s.print}
        </Button>
        <span class="tm-muted">{s.hint}</span>
      </div>
      {guide ? (
        <GuideReader store={store} guide={guide} />
      ) : (
        <p class="tm-empty">{strings.guide.notFound}</p>
      )}
    </main>
  );
}
