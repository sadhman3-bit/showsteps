import { guideSteps, type Guide } from '@showsteps/core';
import { Button, Icon, RichText, strings } from '@showsteps/ui';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getStore, guideRequest } from '../../lib/client';
import type { GuideControl, GuidanceState, Speed } from '../../lib/guideMessages';

const g = strings.guidance;

/** The running Guide Me / Run for me session: current step, controls and the step list. */
export function GuidancePanel({ state }: { state: GuidanceState }) {
  const [guide, setGuide] = useState<Guide>();
  const current = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!state.guideId) return;
    void getStore()
      .getGuide(state.guideId)
      .then((x) => setGuide(x));
  }, [state.guideId]);

  useEffect(() => {
    current.current?.scrollIntoView({ block: 'nearest' });
  }, [state.index]);

  const steps = guide ? guideSteps(guide) : [];
  const step = steps[state.index];
  const control = (action: GuideControl) => void guideRequest({ type: 'guide-control', action });
  const run = state.mode === 'run';
  const done = state.status === 'done';

  const message =
    state.phase === 'failed' && state.reason?.startsWith('expect:')
      ? g.expectFailed(state.reason.slice(7))
      : g.phase[state.phase];
  const reason =
    state.reason && !state.reason.startsWith('expect:') ? g.reasons[state.reason] : undefined;

  const openPage = () => {
    if (state.tabId === undefined || step?.app.kind !== 'web') return;
    void browser.tabs.update(state.tabId, { url: step.app.url, active: true });
  };

  const buttons: [string, GuideControl, ('primary' | 'default' | 'ghost')?][] = [];
  // U9: the element is gone (the app changed): record this step again, keeping the rest.
  const lost =
    !done &&
    (state.phase === 'not-found' || (state.phase === 'failed' && state.reason === 'not-found'));
  if (!done) {
    switch (state.phase) {
      case 'confirm':
        buttons.push([g.confirmDo, 'confirm', 'primary'], [g.didIt, 'next'], [g.skip, 'skip']);
        break;
      case 'acting':
        buttons.push([g.pause, 'pause']);
        break;
      case 'paused':
        buttons.push(
          [g.resume, 'resume', 'primary'],
          ...(state.stepThrough ? ([[g.stepOnce, 'step']] as [string, GuideControl][]) : []),
          [g.didIt, 'next'],
          [g.back, 'back'],
        );
        break;
      case 'failed':
      case 'not-found':
        buttons.push([g.retry, 'retry'], [g.didIt, 'next'], [g.skip, 'skip']);
        break;
      default:
        buttons.push([g.didIt, 'next', 'primary'], [g.skip, 'skip']);
        if (state.index > 0) buttons.push([g.back, 'back']);
        if (run && state.phase !== 'manual') buttons.push([g.pause, 'pause']);
    }
  }

  return (
    <main class="ss-sidepanel ss-guidance">
      <header class="ss-guidance__head">
        <h1>
          <Icon name={run ? 'play' : 'trail'} size={20} /> {run ? g.runForMe : g.guideMe}
        </h1>
        <p class="ss-guidance__title">{state.title}</p>
      </header>

      {done ? (
        <section class="ss-notice ss-stack" role="status">
          <strong>{g.done}</strong>
          <span>{g.doneTitle(state.title ?? '')}</span>
          <Button onClick={() => control('stop')}>{strings.library.close}</Button>
        </section>
      ) : (
        <section class="ss-guidance__now" data-phase={state.phase} aria-live="polite">
          <p class="ss-guidance__count">{g.stepOf(state.index + 1, state.total)}</p>
          {step ? (
            <p class="ss-guidance__step">
              <RichText value={step.human.title} />
            </p>
          ) : null}
          <p class="ss-guidance__phase" data-phase={state.phase}>
            {message}
          </p>
          {reason ? <p class="ss-muted">{reason}</p> : null}
          <div class="ss-guidance__buttons">
            {state.phase === 'navigate' ? (
              <Button variant="primary" onClick={openPage}>
                {g.openPage}
              </Button>
            ) : null}
            {lost ? (
              <Button
                variant="primary"
                title={g.recaptureHint}
                onClick={() => void guideRequest({ type: 'guide-recapture' })}
              >
                {g.recapture}
              </Button>
            ) : null}
            {buttons.map(([label, action, variant]) => (
              <Button key={action} variant={variant ?? 'default'} onClick={() => control(action)}>
                {label}
              </Button>
            ))}
            <Button variant="ghost" onClick={() => control('stop')}>
              {g.stop}
            </Button>
          </div>
          <div
            class="ss-guidance__progress"
            aria-hidden="true"
            style={{
              width: `${Math.round(((state.index + 1) / Math.max(1, state.total)) * 100)}%`,
            }}
          />
          {run ? (
            <div class="ss-guidance__speed">
              <label>
                {g.speed}{' '}
                <select
                  class="ss-input"
                  value={state.speed}
                  onChange={(e) =>
                    void guideRequest({
                      type: 'guide-speed',
                      speed: e.currentTarget.value as Speed,
                      stepThrough: state.stepThrough,
                    })
                  }
                >
                  {(Object.keys(g.speeds) as Speed[]).map((k) => (
                    <option key={k} value={k}>
                      {g.speeds[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  class="ss-toggle"
                  role="switch"
                  checked={state.stepThrough}
                  onChange={(e) =>
                    void guideRequest({
                      type: 'guide-speed',
                      speed: state.speed,
                      stepThrough: e.currentTarget.checked,
                    })
                  }
                />{' '}
                {g.stepThrough}
              </label>
            </div>
          ) : null}
        </section>
      )}

      <section aria-labelledby="steps-h">
        <h2 id="steps-h" class="ss-guidance__h">
          {g.stepsHeading}
        </h2>
        <ol class="ss-guidance__list">
          {steps.map((s, i) => (
            <li
              key={s.id}
              ref={i === state.index ? current : undefined}
              aria-current={i === state.index && !done ? 'step' : undefined}
              class={i < state.index || done ? 'is-done' : ''}
            >
              <button
                type="button"
                onClick={() => void guideRequest({ type: 'guide-goto', index: i })}
              >
                <span class="ss-guidance__n">
                  {i < state.index || done ? <Icon name="check" size={14} /> : i + 1}
                </span>
                <span>
                  <RichText value={s.human.title} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
