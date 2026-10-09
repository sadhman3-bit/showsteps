import { toPlainText, type Guide, type GuideStore, type Step } from '@trailmark/core';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Dialog } from '../components/Dialog.js';
import { Icon } from '../components/Icon.js';
import { RichText } from '../components/RichText.js';
import { strings } from '../strings.js';
import { relativeTime } from '../time.js';
import { Screenshot } from './Screenshot.js';

const s = strings.guide;

export interface GuideViewProps {
  store: GuideStore;
  guideId: string;
  onBack: () => void;
  /** Offered when the platform can record more steps into this guide. */
  onCaptureMore?: (guide: Guide, insertAt: number) => void;
  /** Bumped by the host when the library changes, to reload. */
  refreshKey?: number;
}

/** Read-only view of a guide: headings, callouts and numbered steps with screenshots. */
export function GuideView({ store, guideId, onBack, onCaptureMore, refreshKey }: GuideViewProps) {
  const [guide, setGuide] = useState<Guide | null | undefined>(undefined);
  const [asking, setAsking] = useState(false);

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
  if (guide === null) {
    return (
      <main class="tm-page">
        <Button variant="ghost" onClick={onBack}>
          <Icon name="back" /> {s.back}
        </Button>
        <p class="tm-empty">{s.notFound}</p>
      </main>
    );
  }

  let n = 0;
  const stepNumbers = new Map<string, number>();
  for (const b of guide.blocks) if (b.kind === 'step') stepNumbers.set(b.id, ++n);

  return (
    <main class="tm-page tm-guide">
      <nav class="tm-guide__nav">
        <Button variant="ghost" onClick={onBack}>
          <Icon name="back" /> {s.back}
        </Button>
        {onCaptureMore ? (
          <Button onClick={() => setAsking(true)}>
            <Icon name="record" /> {s.captureMore}
          </Button>
        ) : null}
      </nav>
      <header class="tm-guide__header">
        <h1>{guide.title}</h1>
        {guide.description ? <p class="tm-guide__desc">{guide.description}</p> : null}
        <p class="tm-muted">
          {strings.library.steps(n)} ·{' '}
          {guide.updatedBy
            ? strings.library.editedBy(guide.updatedBy, relativeTime(guide.updatedAt))
            : strings.library.edited(relativeTime(guide.updatedAt))}
        </p>
      </header>
      {guide.blocks.length === 0 ? <p class="tm-empty">{s.noSteps}</p> : null}
      <ol class="tm-blocks">
        {guide.blocks.map((b) => {
          if (b.kind === 'heading') {
            return (
              <li key={b.id} class="tm-block tm-block--heading" id={`block-${b.id}`}>
                <h2>{b.text}</h2>
              </li>
            );
          }
          if (b.kind === 'callout') {
            return (
              <li
                key={b.id}
                class={`tm-block tm-callout tm-callout--${b.tone}`}
                id={`block-${b.id}`}
              >
                <strong>{s.tone[b.tone]}</strong> {b.text}
              </li>
            );
          }
          const num = stepNumbers.get(b.id) ?? 0;
          return <StepCard key={b.id} store={store} guideId={guide.id} step={b} num={num} />;
        })}
      </ol>
      {asking && onCaptureMore ? (
        <CaptureMoreDialog
          guide={guide}
          stepNumbers={stepNumbers}
          onClose={() => setAsking(false)}
          onGo={(at) => {
            setAsking(false);
            onCaptureMore(guide, at);
          }}
        />
      ) : null}
    </main>
  );
}

function StepCard({
  store,
  guideId,
  step,
  num,
}: {
  store: GuideStore;
  guideId: string;
  step: Step;
  num: number;
}) {
  const title = toPlainText(step.human.title);
  return (
    <li class="tm-block tm-step" id={`step-${step.id}`}>
      <div class="tm-step__head">
        <span class="tm-step__num" aria-label={s.stepLabel(num)}>
          {num}
        </span>
        <h3 class="tm-step__title">
          <RichText value={step.human.title} />
        </h3>
      </div>
      {step.human.description ? (
        <p class="tm-step__desc">
          <RichText value={step.human.description} />
        </p>
      ) : null}
      <Screenshot
        store={store}
        guideId={guideId}
        step={step}
        alt={step.human.altText ?? s.screenshotAlt(num, title)}
      />
    </li>
  );
}

function CaptureMoreDialog(props: {
  guide: Guide;
  stepNumbers: Map<string, number>;
  onClose: () => void;
  onGo: (insertAt: number) => void;
}) {
  const steps = props.guide.blocks
    .map((b, index) => ({ b, index }))
    .filter((x): x is { b: Step; index: number } => x.b.kind === 'step');
  const [at, setAt] = useState(String(props.guide.blocks.length));
  return (
    <Dialog
      title={s.captureMore}
      onClose={props.onClose}
      actions={
        <>
          <Button onClick={props.onClose}>{strings.library.cancel}</Button>
          <Button variant="primary" onClick={() => props.onGo(Number(at))}>
            {s.captureMoreGo}
          </Button>
        </>
      }
    >
      <div class="tm-field">
        <label for="tm-insert-at">{s.captureMoreAfter}</label>
        <select
          id="tm-insert-at"
          class="tm-input"
          value={at}
          onChange={(e) => setAt(e.currentTarget.value)}
        >
          <option value="0">{s.captureMoreStart}</option>
          {steps.map(({ b, index }) => (
            <option key={b.id} value={String(index + 1)}>
              {s.stepLabel(props.stepNumbers.get(b.id) ?? 0)}: {toPlainText(b.human.title)}
            </option>
          ))}
        </select>
      </div>
    </Dialog>
  );
}
