import { stepNumbers, toPlainText, type Guide, type GuideSummary } from '@showsteps/core';
import { Button, Icon, Screenshot, relativeTime, strings } from '@showsteps/ui';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  getStore,
  libraryUrl,
  readCaptureMore,
  readRecapture,
  writeRecapture,
  request,
  useBackground,
  useGuidance,
  writeCaptureMore,
} from '../../lib/client';
import { GuidancePanel } from './GuidancePanel';
import { PagePanel } from './PagePanel';
import type { CaptureMore, CaptureState, ControlAction, Recapture } from '../../lib/messages';

const s = strings.sidePanel;
const c = strings.capture;

const ERRORS: Record<string, string> = {
  'permission-needed': s.permissionDenied,
  'cannot-record-here': s.cannotRecordHere,
};

export function SidePanel() {
  const { state, libraryVersion } = useBackground();
  const guidance = useGuidance();
  if (state.status !== 'idle') return <Recording state={state} />;
  if (guidance.status !== 'idle') return <GuidancePanel state={guidance} />;
  return <Idle state={state} libraryVersion={libraryVersion} />;
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
    <main class="ss-sidepanel">
      <h1 class="ss-brand">
        <Icon name="trail" size={22} /> {s.title}
      </h1>
      <p>{strings.app.tagline}</p>

      {state.lastFinishedGuideId ? (
        <p class="ss-notice" role="status">
          {s.justFinished}{' '}
          <button
            type="button"
            class="ss-link"
            onClick={() => openLibrary(state.lastFinishedGuideId)}
          >
            {s.openGuide}
          </button>
        </p>
      ) : null}

      <RecaptureCard />

      {more ? (
        <p class="ss-notice">
          {s.captureMoreInto(more.title, more.afterStep)}{' '}
          <button type="button" class="ss-link" onClick={() => void writeCaptureMore(undefined)}>
            {s.captureMoreCancel}
          </button>
        </p>
      ) : null}

      <Button variant="primary" onClick={() => void start()} disabled={busy}>
        <Icon name="record" /> {s.start}
      </Button>
      <p class="ss-muted">{s.shortcutHint(shortcut)}</p>
      {error ? (
        <p class="ss-error" role="alert">
          {error}
        </p>
      ) : (
        <p class="ss-muted">{s.permissionNote}</p>
      )}

      <PagePanel libraryVersion={libraryVersion} />

      <section aria-labelledby="recent-h" class="ss-recent">
        <h2 id="recent-h">{s.recent}</h2>
        {recent.length ? (
          <ul>
            {recent.map((g) => (
              <li key={g.id}>
                <button type="button" class="ss-link" onClick={() => openLibrary(g.id)}>
                  {g.title}
                </button>
                <span class="ss-muted">
                  {strings.library.steps(g.stepCount)} · {relativeTime(g.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="ss-muted">{s.noGuides}</p>
        )}
        <Button onClick={() => openLibrary()}>
          <Icon name="library" /> {s.openLibrary}
        </Button>
      </section>
      <p class="ss-sidepanel__note">{s.privacyNote}</p>
    </main>
  );
}

function Recording({ state }: { state: CaptureState }) {
  const [confirming, setConfirming] = useState(false);
  const paused = state.status === 'paused';
  const control = (action: ControlAction) => void request({ type: 'control', action });
  return (
    <main class="ss-sidepanel ss-sidepanel--recording">
      <div class="ss-rec-head">
        <section class="ss-status" aria-live="polite">
          <span class={`ss-dot${paused ? ' ss-dot--paused' : ''}`} aria-hidden="true" />
          <strong>{paused ? c.paused : c.recording}</strong>
          <span class="ss-muted">{c.steps(state.stepCount)}</span>
        </section>
        {state.title ? <p class="ss-muted ss-rec-title">{state.title}</p> : null}
        {confirming ? (
          <div class="ss-stack">
            <p>{c.cancelConfirm}</p>
            <Button variant="danger" onClick={() => control('cancel')}>
              {c.cancel}
            </Button>
            <Button onClick={() => setConfirming(false)}>{c.resume}</Button>
          </div>
        ) : (
          <div class="ss-rec-controls">
            <Button variant="primary" onClick={() => control('finish')}>
              {c.finish}
            </Button>
            <Button onClick={() => control(paused ? 'resume' : 'pause')}>
              {paused ? c.resume : c.pause}
            </Button>
            <Button aria-pressed={state.liveBlur} onClick={() => control('toggle-live-blur')}>
              {c.liveBlur}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              {c.cancel}
            </Button>
          </div>
        )}
        {state.liveBlur ? <p class="ss-muted">{c.liveBlurOn}</p> : null}
      </div>
      <RecordedSteps state={state} />
    </main>
  );
}

/** The capture's steps as they are recorded: number, text and screenshot, newest last. */
function RecordedSteps({ state }: { state: CaptureState }) {
  const [guide, setGuide] = useState<Guide>();
  const end = useRef<HTMLDivElement>(null);
  const ids = state.stepIds ?? [];
  const key = `${ids.join(',')}|${state.lastStep?.title ?? ''}`;
  useEffect(() => {
    if (!state.guideId) return;
    let cancelled = false;
    void getStore()
      .getGuide(state.guideId)
      .then((g) => {
        if (!cancelled && g) setGuide(g);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state.guideId, key]);
  const byId = new Map(
    (guide?.blocks ?? []).flatMap((b) => (b.kind === 'step' ? [[b.id, b] as const] : [])),
  );
  const numbers = guide ? stepNumbers(guide) : new Map<string, number>();
  const steps = ids.flatMap((id) => {
    const step = byId.get(id);
    return step ? [step] : [];
  });
  const shown = steps.length;
  // Bring a new step into view once it has loaded (not on every refresh, so reading back is undisturbed).
  const seen = useRef(0);
  useEffect(() => {
    if (shown <= seen.current) {
      seen.current = shown;
      return;
    }
    seen.current = shown;
    end.current?.scrollIntoView({ block: 'end' });
  }, [shown]);

  return (
    <section class="ss-rec-steps" aria-labelledby="rec-steps-h">
      <h2 id="rec-steps-h">{c.stepsTitle}</h2>
      {steps.length ? (
        <ol>
          {steps.map((step) => {
            const n = numbers.get(step.id) ?? 0;
            const title = toPlainText(step.human.title);
            return (
              <li key={step.id} class="ss-rec-step" aria-label={`${c.stepLabel(n)}: ${title}`}>
                <div class="ss-rec-step__head">
                  <span class="ss-step__num">{n}</span>
                  <span class="ss-rec-step__title">{title}</span>
                  <button
                    type="button"
                    class="ss-rec-step__delete"
                    aria-label={c.deleteStep(n)}
                    title={c.deleteStep(n)}
                    onClick={() => void request({ type: 'delete-step', stepId: step.id })}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
                {step.human.screenshot && guide ? (
                  <Screenshot store={getStore()} guideId={guide.id} step={step} alt={title} />
                ) : (
                  <p class="ss-muted ss-rec-step__wait">{c.pictureComing}</p>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p class="ss-muted">{c.noStepsYet}</p>
      )}
      <div ref={end} />
    </section>
  );
}

/** Re-capture hand-over from the editor: replace one step's screenshot with this window's tab. */
function RecaptureCard() {
  const [req, setReq] = useState<Recapture>();
  const [message, setMessage] = useState('');
  useEffect(() => {
    void readRecapture().then(setReq);
    const onChange = (changes: Record<string, unknown>, area: string) => {
      if (area === 'session' && 'recapture' in changes) void readRecapture().then(setReq);
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);
  if (!req)
    return message ? (
      <p class="ss-notice" role="status">
        {message}
      </p>
    ) : null;
  const capture = async () => {
    // Permission first, inside the click: capturing a tab needs website access.
    const granted = await browser.permissions.request({ origins: ['<all_urls>'] });
    if (!granted) {
      setMessage(s.permissionDenied);
      return;
    }
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return;
    const reply = await request({
      type: 'recapture',
      tabId: tab.id,
      guideId: req.guideId,
      stepId: req.stepId,
    });
    if (reply.error) {
      setMessage(reply.error === 'busy' ? s.busy : s.recaptureFailed);
      return;
    }
    await writeRecapture(undefined);
    setMessage(s.recaptureDone);
  };
  return (
    <section class="ss-notice ss-stack" aria-live="polite">
      <p>{s.recaptureFor(req.stepNumber, req.title)}</p>
      <Button variant="primary" onClick={() => void capture()}>
        {s.recaptureGo}
      </Button>
      <Button variant="ghost" onClick={() => void writeRecapture(undefined)}>
        {s.recaptureCancel}
      </Button>
      {message ? (
        <p class="ss-error" role="alert">
          {message}
        </p>
      ) : null}
    </section>
  );
}
