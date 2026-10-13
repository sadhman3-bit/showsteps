import {
  alreadyBlurred,
  findSensitiveOnPage,
  maskValue,
  parsePageText,
  serializePageText,
  toPlainText,
  wordsFileFor,
  type Guide,
  type GuideStore,
  type PageText,
  type Rect,
  type SensitiveFinding,
  type Step,
} from '@showsteps/core';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Dialog } from '../components/Dialog.js';
import { mimeFor, useImageUrl, usePreference } from '../hooks.js';
import { readPicture } from '../ocr/ocr.js';
import { strings } from '../strings.js';

const s = strings.secureBlur;

interface StepFindings {
  step: Step;
  number: number;
  findings: SensitiveFinding[];
}

/**
 * Find sensitive values in every screenshot: from the word positions saved at capture (web
 * steps), or by reading the picture with OCR (desktop, uploaded and older steps). OCR results
 * are saved next to the picture, so the next scan is instant.
 */
async function scan(
  store: GuideStore,
  guide: Guide,
  options: { amounts: boolean; names: string[] },
  onReading: (done: number, total: number) => void,
): Promise<{ found: StepFindings[]; unscanned: number }> {
  const steps = guide.blocks.filter((b): b is Step => b.kind === 'step');
  const files = [
    ...new Set(steps.flatMap((st) => (st.human.screenshot ? [st.human.screenshot.file] : []))),
  ];
  const pages = new Map<string, PageText | undefined>();
  const toRead: string[] = [];
  for (const file of files) {
    const bytes = await store.getImage(guide.id, wordsFileFor(file)).catch(() => undefined);
    const page = bytes ? parsePageText(bytes) : undefined;
    pages.set(file, page);
    if (!page) toRead.push(file);
  }
  for (const [i, file] of toRead.entries()) {
    onReading(i, toRead.length);
    const name = file.replace(/^img\//, '');
    try {
      const bytes = await store.getImage(guide.id, name);
      if (!bytes) continue;
      const page = await readPicture(new Blob([bytes.slice()], { type: mimeFor(name) }));
      pages.set(file, page);
      await store.putImage(guide.id, wordsFileFor(file), serializePageText(page));
    } catch {
      // Left as "not checked": the person blurs it by hand.
    }
  }
  const found: StepFindings[] = [];
  let unscanned = 0;
  steps.forEach((step, i) => {
    const file = step.human.screenshot?.file;
    if (!file) return;
    const page = pages.get(file);
    if (!page) {
      unscanned++;
      return;
    }
    const findings = findSensitiveOnPage(page, options).filter(
      (f) => !alreadyBlurred(step, f.rect),
    );
    if (findings.length) found.push({ step, number: i + 1, findings });
  });
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
  const [reading, setReading] = useState<[number, number]>();

  useEffect(() => {
    let live = true;
    setResult(undefined);
    const list = names
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    setReading(undefined);
    void scan(
      props.store,
      props.guide,
      { amounts: amounts === 'on', names: list },
      (done, total) => {
        if (live) setReading([done + 1, total]);
      },
    ).then((r) => {
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
      <p class="ss-muted">{s.hint}</p>
      <div class="ss-stack-form ss-secure__options">
        <label class="ss-check">
          <input
            type="checkbox"
            checked={amounts === 'on'}
            onChange={(e) => setAmounts(e.currentTarget.checked ? 'on' : 'off')}
          />{' '}
          {s.amounts}
        </label>
        <label class="ss-field">
          {s.names}
          <div class="ss-row">
            <input
              class="ss-input"
              value={names}
              onInput={(e) => setNames(e.currentTarget.value)}
            />
            <Button onClick={() => setRun(run + 1)}>{s.scan}</Button>
          </div>
          <small class="ss-muted">{s.namesHint}</small>
        </label>
      </div>
      {!result ? (
        <p role="status">{reading ? s.reading(reading[0], reading[1]) : s.scanning}</p>
      ) : (
        <div class="ss-secure" role="region" aria-label={s.title}>
          {result.found.length ? (
            <div class="ss-row">
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
            <section key={sf.step.id} class="ss-secure__step">
              <h3>{s.stepHeading(sf.number, toPlainText(sf.step.human.title))}</h3>
              <FindingsPreview store={props.store} guideId={props.guide.id} item={sf} />
              <ul class="ss-secure__list">
                {sf.findings.map((f) => {
                  const key = keyOf(sf.step.id, f.id);
                  return (
                    <li key={key}>
                      <label class="ss-check">
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
          {result.unscanned ? <p class="ss-muted">{s.unscanned(result.unscanned)}</p> : null}
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
      class="ss-secure__preview"
      viewBox={`0 0 ${shot.width} ${shot.height}`}
      role="img"
      aria-label={s.preview(props.item.number)}
    >
      <image href={url} width={shot.width} height={shot.height} />
      {props.item.findings.map((f) => (
        <rect
          key={f.id}
          class="ss-secure__mark"
          x={f.rect.x}
          y={f.rect.y}
          width={f.rect.w}
          height={f.rect.h}
        />
      ))}
    </svg>
  );
}
