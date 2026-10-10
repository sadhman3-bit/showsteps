import {
  alreadyBlurred,
  findSensitiveOnPage,
  maskValue,
  parsePageText,
  toPlainText,
  wordsFileFor,
  type Guide,
  type GuideStore,
  type Rect,
  type SensitiveFinding,
  type Step,
} from '@trailmark/core';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Dialog } from '../components/Dialog.js';
import { useImageUrl, usePreference } from '../hooks.js';
import { strings } from '../strings.js';

const s = strings.secureBlur;

interface StepFindings {
  step: Step;
  number: number;
  findings: SensitiveFinding[];
}

/** Find sensitive values in every screenshot from the word positions saved at capture. */
async function scan(
  store: GuideStore,
  guide: Guide,
  options: { amounts: boolean; names: string[] },
): Promise<{ found: StepFindings[]; unscanned: number }> {
  const found: StepFindings[] = [];
  let unscanned = 0;
  let number = 0;
  const pages = new Map<string, ReturnType<typeof parsePageText>>();
  for (const block of guide.blocks) {
    if (block.kind !== 'step') continue;
    number++;
    const file = block.human.screenshot?.file;
    if (!file) continue;
    if (!pages.has(file)) {
      const bytes = await store.getImage(guide.id, wordsFileFor(file)).catch(() => undefined);
      pages.set(file, bytes ? parsePageText(bytes) : undefined);
    }
    const page = pages.get(file);
    if (!page) {
      unscanned++;
      continue;
    }
    const findings = findSensitiveOnPage(page, options).filter(
      (f) => !alreadyBlurred(block, f.rect),
    );
    if (findings.length) found.push({ step: block, number, findings });
  }
  return { found, unscanned };
}

const keyOf = (stepId: string, findingId: string) => `${stepId}|${findingId}`;

/**
 * Secure Blur (E11): one click finds emails, phone, card, bank and tax numbers in every
 * screenshot; nothing is blurred until the person has reviewed the list.
 */
export function SecureBlurDialog(props: {
  store: GuideStore;
  guide: Guide;
  onApply: (blurs: Map<string, Rect[]>) => void;
  onClose: () => void;
}) {
  const [amounts, setAmounts] = usePreference<'on' | 'off'>('secureBlur.amounts', 'off');
  const [names, setNames] = usePreference<string>('secureBlur.names', '');
  const [result, setResult] = useState<{ found: StepFindings[]; unscanned: number }>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [run, setRun] = useState(0);

  useEffect(() => {
    let live = true;
    setResult(undefined);
    const list = names
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    void scan(props.store, props.guide, { amounts: amounts === 'on', names: list }).then((r) => {
      if (!live) return;
      setResult(r);
      setSelected(
        new Set(r.found.flatMap((sf) => sf.findings.map((f) => keyOf(sf.step.id, f.id)))),
      );
    });
    return () => {
      live = false;
    };
    // Re-scan when the options change (names on "Find again", to avoid a scan per keystroke).
  }, [props.store, props.guide.id, amounts, run]);

  const all = result?.found.flatMap((sf) => sf.findings.map((f) => keyOf(sf.step.id, f.id))) ?? [];
  const toggle = (key: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    setSelected(next);
  };
  const apply = () => {
    const blurs = new Map<string, Rect[]>();
    for (const sf of result?.found ?? []) {
      const rects = sf.findings.filter((f) => selected.has(keyOf(sf.step.id, f.id)));
      if (rects.length)
        blurs.set(
          sf.step.id,
          rects.map((f) => f.rect),
        );
    }
    props.onApply(blurs);
  };

  return (
    <Dialog
      title={s.title}
      onClose={props.onClose}
      actions={
        <>
          <Button onClick={props.onClose}>{strings.library.cancel}</Button>
          <Button variant="primary" disabled={!selected.size} onClick={apply}>
            {s.apply(selected.size)}
          </Button>
        </>
      }
    >
      <p class="tm-muted">{s.hint}</p>
      <div class="tm-stack-form tm-secure__options">
        <label class="tm-check">
          <input
            type="checkbox"
            checked={amounts === 'on'}
            onChange={(e) => setAmounts(e.currentTarget.checked ? 'on' : 'off')}
          />{' '}
          {s.amounts}
        </label>
        <label class="tm-field">
          {s.names}
          <div class="tm-row">
            <input
              class="tm-input"
              value={names}
              onInput={(e) => setNames(e.currentTarget.value)}
            />
            <Button onClick={() => setRun(run + 1)}>{s.scan}</Button>
          </div>
          <small class="tm-muted">{s.namesHint}</small>
        </label>
      </div>
      {!result ? (
        <p role="status">{s.scanning}</p>
      ) : (
        <div class="tm-secure" role="region" aria-label={s.title}>
          {result.found.length ? (
            <div class="tm-row">
              <Button variant="ghost" onClick={() => setSelected(new Set(all))}>
                {s.selectAll}
              </Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                {s.selectNone}
              </Button>
            </div>
          ) : (
            <p role="status">{s.none}</p>
          )}
          {result.found.map((sf) => (
            <section key={sf.step.id} class="tm-secure__step">
              <h3>{s.stepHeading(sf.number, toPlainText(sf.step.human.title))}</h3>
              <FindingsPreview store={props.store} guideId={props.guide.id} item={sf} />
              <ul class="tm-secure__list">
                {sf.findings.map((f) => {
                  const key = keyOf(sf.step.id, f.id);
                  return (
                    <li key={key}>
                      <label class="tm-check">
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={(e) => toggle(key, e.currentTarget.checked)}
                        />{' '}
                        <strong>{s.kinds[f.kind]}</strong> <code>{maskValue(f.text)}</code>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {result.unscanned ? <p class="tm-muted">{s.unscanned(result.unscanned)}</p> : null}
        </div>
      )}
    </Dialog>
  );
}

/** The step's screenshot with each found item outlined. */
function FindingsPreview(props: { store: GuideStore; guideId: string; item: StepFindings }) {
  const shot = props.item.step.human.screenshot;
  const url = useImageUrl(props.store, props.guideId, shot?.file.replace(/^img\//, ''));
  if (!shot || !url) return null;
  return (
    <svg
      class="tm-secure__preview"
      viewBox={`0 0 ${shot.width} ${shot.height}`}
      role="img"
      aria-label={s.preview(props.item.number)}
    >
      <image href={url} width={shot.width} height={shot.height} />
      {props.item.findings.map((f) => (
        <rect
          key={f.id}
          class="tm-secure__mark"
          x={f.rect.x}
          y={f.rect.y}
          width={f.rect.w}
          height={f.rect.h}
        />
      ))}
    </svg>
  );
}
