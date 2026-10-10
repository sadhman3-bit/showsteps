import { guideSteps, type Guide } from '@trailmark/core';
import { Button, Icon, RichText, strings } from '@trailmark/ui';
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
        buttons.push([g.retry, 'retry', 'primary'], [g.didIt, 'next'], [g.skip, 'skip']);
        break;
      default:
        buttons.push([g.didIt, 'next', 'primary'], [g.skip, 'skip']);
        if (state.index > 0) buttons.push([g.back, 'back']);
        if (run && state.phase !== 'manual') buttons.push([g.pause, 'pause']);
    }
  }

  return (
    <main class="tm-sidepanel tm-guidance">
      <h1 class="tm-brand">
        <Icon name="trail" size={22} /> {run ? g.runForMe : g.guideMe}
      </h1>
      <p class="tm-guidance__title">{state.title}</p>

      {done ? (
        <section class="tm-notice tm-stack" role="status">
          <strong>{g.done}</strong>
          <span>{g.doneTitle(state.title ?? '')}</span>
          <Button onClick={() => control('stop')}>{strings.library.close}</Button>
        </section>
      ) : (
        <section class="tm-guidance__now" aria-live="polite">
          <p class="tm-muted">{g.stepOf(state.index + 1, state.total)}</p>
          {step ? (
            <p class="tm-guidance__step">
              <RichText value={step.human.title} />
            </p>
          ) : null}
          <p class="tm-guidance__phase" data-phase={state.phase}>
            {message}
          </p>
          {reason ? <p class="tm-muted">{reason}</p> : null}
          <div class="tm-guidance__buttons">
            {state.phase === 'navigate' ? (
              <Button variant="primary" onClick={openPage}>
                {g.openPage}
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
          {run ? (
            <div class="tm-guidance__speed">
              <label>
                {g.speed}{' '}
                <select
                  class="tm-input"
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
        <h2 id="steps-h" class="tm-guidance__h">
          {g.stepsHeading}
        </h2>
        <ol class="tm-guidance__list">
          {steps.map((s, i) => (
            <li
              key={s.id}
              ref={i === state.index ? current : undefined}
              aria-current={i === state.index && !done ? 'step' : undefined}
              class={i < state.index || done ? 'is-done' : ''}
            >
              <button
                type="button"
                class="tm-link"
                onClick={() => void guideRequest({ type: 'guide-goto', index: i })}
              >
                <span class="tm-guidance__n">{i < state.index || done ? '✓' : i + 1}</span>
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
