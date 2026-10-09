import type { GuideSummary } from '@trailmark/core';
import { Button, Icon, relativeTime, strings } from '@trailmark/ui';
import { useEffect, useState } from 'preact/hooks';
import {
  getStore,
  libraryUrl,
  readCaptureMore,
  request,
  useBackground,
  writeCaptureMore,
} from '../../lib/client';
import type { CaptureMore, CaptureState, ControlAction } from '../../lib/messages';

const s = strings.sidePanel;
const c = strings.capture;

const ERRORS: Record<string, string> = {
  'permission-needed': s.permissionDenied,
  'cannot-record-here': s.cannotRecordHere,
};

export function SidePanel() {
  const { state, libraryVersion } = useBackground();
  return state.status === 'idle' ? (
    <Idle state={state} libraryVersion={libraryVersion} />
  ) : (
    <Recording state={state} />
  );
}

function openLibrary(guideId?: string) {
  void browser.tabs.create({ url: libraryUrl(guideId) });
}

function Idle({ state, libraryVersion }: { state: CaptureState; libraryVersion: number }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState<CaptureMore>();
  const [recent, setRecent] = useState<GuideSummary[]>([]);
  const [shortcut, setShortcut] = useState('Alt+Shift+R');

  useEffect(() => {
    void readCaptureMore().then(setMore);
    const onChange = (changes: Record<string, unknown>, area: string) => {
      if (area === 'session' && 'captureMore' in changes) void readCaptureMore().then(setMore);
    };
    browser.storage.onChanged.addListener(onChange);
    void browser.commands.getAll().then((all) => {
      const cmd = all.find((x) => x.name === 'toggle-capture');
      if (cmd?.shortcut) setShortcut(cmd.shortcut);
    });
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);

  useEffect(() => {
    void getStore()
      .listGuides()
      .then((list) =>
        setRecent([...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5)),
      )
      .catch(() => setRecent([]));
  }, [libraryVersion]);

  const start = async () => {
    setError('');
    setBusy(true);
    try {
      // Must be the first call in the click handler: permission prompts need the user gesture.
      const granted = await browser.permissions.request({ origins: ['<all_urls>'] });
      if (!granted) {
        setError(s.permissionDenied);
        return;
      }
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) {
        setError(s.cannotRecordHere);
        return;
      }
      const reply = await request({
        type: 'start',
        tabId: tab.id,
        ...(more ? { guideId: more.guideId, insertAt: more.insertAt } : {}),
      });
      if (reply.error) setError(ERRORS[reply.error] ?? strings.errors.generic);
      else if (more) await writeCaptureMore(undefined);
    } catch {
      setError(strings.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main class="tm-sidepanel">
      <h1 class="tm-brand">
        <Icon name="trail" size={22} /> {s.title}
      </h1>
      <p>{strings.app.tagline}</p>

      {state.lastFinishedGuideId ? (
        <p class="tm-notice" role="status">
          {s.justFinished}{' '}
          <button
            type="button"
            class="tm-link"
            onClick={() => openLibrary(state.lastFinishedGuideId)}
          >
            {s.openGuide}
          </button>
        </p>
      ) : null}

      {more ? (
        <p class="tm-notice">
          {s.captureMoreInto(more.title, more.afterStep)}{' '}
          <button type="button" class="tm-link" onClick={() => void writeCaptureMore(undefined)}>
            {s.captureMoreCancel}
          </button>
        </p>
      ) : null}

      <Button variant="primary" onClick={() => void start()} disabled={busy}>
        <Icon name="record" /> {s.start}
      </Button>
      <p class="tm-muted">{s.shortcutHint(shortcut)}</p>
      {error ? (
        <p class="tm-error" role="alert">
          {error}
        </p>
      ) : (
        <p class="tm-muted">{s.permissionNote}</p>
      )}

      <section aria-labelledby="recent-h" class="tm-recent">
        <h2 id="recent-h">{s.recent}</h2>
        {recent.length ? (
          <ul>
            {recent.map((g) => (
              <li key={g.id}>
                <button type="button" class="tm-link" onClick={() => openLibrary(g.id)}>
                  {g.title}
                </button>
                <span class="tm-muted">
                  {strings.library.steps(g.stepCount)} · {relativeTime(g.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="tm-muted">{s.noGuides}</p>
        )}
        <Button onClick={() => openLibrary()}>
          <Icon name="library" /> {s.openLibrary}
        </Button>
      </section>
      <p class="tm-sidepanel__note">{s.privacyNote}</p>
    </main>
  );
}

function Recording({ state }: { state: CaptureState }) {
  const [confirming, setConfirming] = useState(false);
  const paused = state.status === 'paused';
  const control = (action: ControlAction) => void request({ type: 'control', action });
  return (
    <main class="tm-sidepanel">
      <h1 class="tm-brand">
        <Icon name="trail" size={22} /> {s.title}
      </h1>
      <section class="tm-status" aria-live="polite">
        <span class={`tm-dot${paused ? ' tm-dot--paused' : ''}`} aria-hidden="true" />
        <strong>{paused ? c.paused : c.recording}</strong>
        <span class="tm-muted">{c.steps(state.stepCount)}</span>
      </section>
      {state.title ? <p class="tm-muted">{state.title}</p> : null}
      {confirming ? (
        <div class="tm-stack">
          <p>{c.cancelConfirm}</p>
          <Button variant="danger" onClick={() => control('cancel')}>
            {c.cancel}
          </Button>
          <Button onClick={() => setConfirming(false)}>{c.resume}</Button>
        </div>
      ) : (
        <div class="tm-stack">
          <Button variant="primary" onClick={() => control('finish')}>
            {c.finish}
          </Button>
          <Button onClick={() => control(paused ? 'resume' : 'pause')}>
            {paused ? c.resume : c.pause}
          </Button>
          <Button onClick={() => control('delete-last')} disabled={state.stepCount === 0}>
            {c.deleteLast}
          </Button>
          <Button aria-pressed={state.liveBlur} onClick={() => control('toggle-live-blur')}>
            {c.liveBlur}
          </Button>
          {state.liveBlur ? <p class="tm-muted">{c.liveBlurOn}</p> : null}
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            {c.cancel}
          </Button>
        </div>
      )}
    </main>
  );
}
