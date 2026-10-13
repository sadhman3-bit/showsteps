import { strings } from '@showsteps/ui';
import { api, usePushed, type CaptureView } from './api';

const c = strings.capture;

/** The small always-on-top capture toolbar (excluded from screenshots). */
export function Controller() {
  const state = usePushed<CaptureView>(
    'capture-state',
    { status: 'recording', stepCount: 0, shared: false },
    () => api().invoke('capture:state'),
  );
  const paused = state.status === 'paused';
  const control = (action: string) => void api().invoke('capture:control', action);
  return (
    <div
      class={`ss-ctl${paused ? ' is-paused' : ''}`}
      role="toolbar"
      aria-label={strings.desktop.controllerLabel}
    >
      <span class="ss-ctl__grip" aria-hidden="true">
        ⋮⋮
      </span>
      <span class="ss-ctl__dot" aria-hidden="true" />
      <span class="ss-ctl__status">
        <strong>{paused ? c.paused : c.recording}</strong> <span>{c.steps(state.stepCount)}</span>
      </span>
      <button type="button" onClick={() => control(paused ? 'resume' : 'pause')}>
        {paused ? c.resume : c.pause}
      </button>
      <button
        type="button"
        onClick={() => control('delete-last')}
        title={c.deleteLast}
        aria-label={c.deleteLast}
      >
        ↶
      </button>
      <button type="button" class="primary" onClick={() => control('finish')}>
        {c.finish}
      </button>
      <button
        type="button"
        onClick={() => control('cancel')}
        title={c.cancel}
        aria-label={c.cancel}
      >
        ×
      </button>
    </div>
  );
}
