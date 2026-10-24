import { receivedSummary, runFields, trustGuide, type Guide } from '@showsteps/core';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Dialog } from '../components/Dialog.js';
import { strings } from '../strings.js';

const g = strings.guidance;
const r = g.received;
export type RunSpeed = 'slow' | 'normal' | 'fast';
/** What the Run dialog hands over: values, speed and step-through. */
export interface RunOptions {
  values: Record<string, string>;
  speed: RunSpeed;
  stepThrough: boolean;
}

/** Run for me (G6): values asked once, speed and step-through, then start. */
export function RunDialog({
  guide,
  onStart,
  onClose,
  cancelLabel = strings.library.cancel,
  notice,
  onTrust,
}: {
  guide: Guide;
  onStart: (opts: RunOptions) => void;
  onClose: () => void;
  /** The close button's words ("Not now" in the start window). */
  cancelLabel?: string;
  /** A line above the fields (e.g. the guide changed since a file was made). */
  notice?: ComponentChildren;
  /** "Trust this guide" (H4): save the guide without its received mark. */
  onTrust?: (trusted: Guide) => void | Promise<void>;
}) {
  const fields = runFields(guide);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.defaultValue])),
  );
  const [speed, setSpeed] = useState<RunSpeed>('normal');
  const [stepThrough, setStepThrough] = useState(false);
  // H4: a guide from someone else shows what it does; Start waits for the person's tick.
  const [received, setReceived] = useState(guide.received);
  const [checked, setChecked] = useState(false);
  const blocked = !!received && !checked;
  const submit = (e: Event) => {
    e.preventDefault();
    if (blocked) return;
    onStart({ values, speed, stepThrough });
  };
  return (
    <Dialog
      title={g.runTitle}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{cancelLabel}</Button>
          <Button variant="primary" type="submit" form="ss-run" disabled={blocked}>
            {g.runStart}
          </Button>
        </>
      }
    >
      <form id="ss-run" class="ss-stack-form" onSubmit={submit}>
        {notice}
        {received ? (
          <ReceivedPanel
            guide={guide}
            from={received}
            checked={checked}
            onCheck={setChecked}
            {...(onTrust
              ? {
                  onTrust: async () => {
                    await onTrust(trustGuide(guide));
                    setReceived(undefined);
                  },
                }
              : {})}
          />
        ) : null}
        <p class="ss-muted">{g.runIntro}</p>
        {fields.length ? (
          <fieldset class="ss-fieldset">
            <legend>{g.runValues}</legend>
            {fields.map((f) => (
              <label key={f.key} class="ss-field">
                {f.label}
                <input
                  class="ss-input"
                  value={values[f.key] ?? ''}
                  onInput={(e) => setValues({ ...values, [f.key]: e.currentTarget.value })}
                />
                {f.description ? <small class="ss-muted">{f.description}</small> : null}
              </label>
            ))}
          </fieldset>
        ) : null}
        <label class="ss-field">
          {g.speed}
          <select
            class="ss-input"
            value={speed}
            onChange={(e) => setSpeed(e.currentTarget.value as RunSpeed)}
          >
            {(Object.keys(g.speeds) as RunSpeed[]).map((k) => (
              <option key={k} value={k}>
                {g.speeds[k]}
              </option>
            ))}
          </select>
        </label>
        <label class="ss-check">
          <input
            type="checkbox"
            checked={stepThrough}
            onChange={(e) => setStepThrough(e.currentTarget.checked)}
          />{' '}
          {g.stepThrough}
        </label>
      </form>
    </Dialog>
  );
}

/** What a guide from someone else does, listed before Run for me acts on it (H4). */
export function ReceivedPanel(props: {
  guide: Guide;
  from: NonNullable<Guide['received']>;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  onTrust?: () => void;
}) {
  const sum = receivedSummary(props.guide);
  const list = (items: string[]) =>
    items.length ? (
      <ul>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    ) : (
      <p class="ss-muted">{r.none}</p>
    );
  return (
    <section class="ss-received" aria-labelledby="ss-received-h">
      <h3 id="ss-received-h">{r.title}</h3>
      <p>{props.from.from === 'shared-folder' ? r.fromFolder : r.intro(props.from.file)}</p>
      <h4>{r.sites}</h4>
      {list(sum.sites)}
      <h4>{r.typed}</h4>
      {list(sum.typed.map((t) => r.typedItem(t.step, t.field, t.value)))}
      <h4>{r.attaches}</h4>
      {list(sum.attaches.map((a) => r.attachItem(a.step, a.to, a.from)))}
      <h4>{r.stops}</h4>
      {list(sum.stops.map((x) => r.stopItem(x.step, x.title, x.why)))}
      <label class="ss-check">
        <input
          type="checkbox"
          checked={props.checked}
          onChange={(e) => props.onCheck(e.currentTarget.checked)}
        />{' '}
        {r.checked}
      </label>
      {props.onTrust ? (
        <div class="ss-received__trust">
          <Button size="sm" onClick={props.onTrust} disabled={!props.checked}>
            {r.trust}
          </Button>
          <small class="ss-muted">{r.trustHint}</small>
        </div>
      ) : null}
    </section>
  );
}
