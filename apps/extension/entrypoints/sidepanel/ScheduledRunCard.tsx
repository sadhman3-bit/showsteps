import { Button, Icon, strings } from '@showsteps/ui';
import { guideRequest } from '../../lib/client';
import type { GuideControl, GuidanceState } from '../../lib/guideMessages';

const g = strings.guidance;
const s = strings.schedules;

/**
 * S3: a scheduled run is going in its own window. The side panel keeps its usual screen and shows
 * this card on top: the step it's on, and Pause and Stop.
 */
export function ScheduledRunCard({ state }: { state: GuidanceState }) {
  const control = (action: GuideControl) => void guideRequest({ type: 'guide-control', action });
  const signIn = state.phase === 'failed' && state.reason === 'sign-in';
  const message = signIn ? g.signIn : g.phase[state.phase];
  const showWindow = () => {
    if (state.tabId === undefined) return;
    void browser.tabs
      .get(state.tabId)
      .then((tab) => browser.windows.update(tab.windowId, { focused: true }))
      .catch(() => undefined);
  };
  return (
    <section class="ss-runcard" aria-labelledby="ss-runcard-h" aria-live="polite">
      <p class="ss-runcard__kind">
        <Icon name="clock" size={16} /> {s.scheduledRun}
      </p>
      <h2 id="ss-runcard-h" class="ss-runcard__title">
        {state.title}
      </h2>
      <p class="ss-runcard__step">
        {g.stepOf(Math.min(state.index + 1, state.total), state.total)} · {message}
      </p>
      <div class="ss-runcard__buttons">
        {state.phase === 'paused' ? (
          <Button size="sm" variant="primary" onClick={() => control('resume')}>
            <Icon name="play" size={16} /> {g.resume}
          </Button>
        ) : signIn ? (
          <Button size="sm" variant="primary" onClick={() => control('retry')}>
            {g.continue}
          </Button>
        ) : (
          <Button size="sm" onClick={() => control('pause')}>
            <Icon name="pause" size={16} /> {g.pause}
          </Button>
        )}
        <Button size="sm" onClick={() => control('stop')}>
          <Icon name="stop" size={16} /> {g.stop}
        </Button>
        <Button size="sm" variant="ghost" onClick={showWindow}>
          {s.showWindow}
        </Button>
      </div>
      <div
        class="ss-runcard__progress"
        aria-hidden="true"
        style={{
          width: `${Math.round((Math.min(state.index + 1, state.total) / Math.max(1, state.total)) * 100)}%`,
        }}
      />
    </section>
  );
}
