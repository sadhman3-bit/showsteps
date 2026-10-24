import { runFields, type Guide } from '@showsteps/core';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Dialog } from '../components/Dialog.js';
import { strings } from '../strings.js';

const g = strings.guidance;
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
}: {
  guide: Guide;
  onStart: (opts: RunOptions) => void;
  onClose: () => void;
  /** The close button's words ("Not now" in the start window). */
  cancelLabel?: string;
  /** A line above the fields (e.g. the guide changed since a file was made). */
  notice?: ComponentChildren;
}) {
  const fields = runFields(guide);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.defaultValue])),
  );
  const [speed, setSpeed] = useState<RunSpeed>('normal');
  const [stepThrough, setStepThrough] = useState(false);
  const submit = (e: Event) => {
    e.preventDefault();
    onStart({ values, speed, stepThrough });
  };
  return (
    <Dialog
      title={g.runTitle}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{cancelLabel}</Button>
          <Button variant="primary" type="submit" form="ss-run">
            {g.runStart}
          </Button>
        </>
      }
    >
      <form id="ss-run" class="ss-stack-form" onSubmit={submit}>
        {notice}
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
