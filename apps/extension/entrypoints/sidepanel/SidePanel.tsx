import { stepNumbers, toPlainText, type Guide, type GuideSummary } from '@showsteps/core';
import {
  Button,
  Chip,
  Dialog,
  Icon,
  IconButton,
  Menu,
  RipplePattern,
  Screenshot,
  relativeTime,
  strings,
} from '@showsteps/ui';
import { LOCKUP_SVG } from '@showsteps/ui/brand';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  getStore,
  libraryUrl,
  readCaptureMore,
  readRecapture,
  writeRecapture,
  request,
  useActiveTab,
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
      <header class="ss-hero">
        <RipplePattern class="ss-hero__band" />
        <h1 class="ss-hero__lockup">
          <span
            class="ss-lockup"
            role="img"
            aria-label={s.title}
            dangerouslySetInnerHTML={{ __html: LOCKUP_SVG }}
          />
        </h1>
      </header>
      <p class="ss-hero__tagline">{strings.app.tagline}</p>

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

      <div class="ss-startcard">
        <Button
          variant="primary"
          size="lg"
          class="ss-startcard__go"
          onClick={() => void start()}
          disabled={busy}
          aria-keyshortcuts={shortcut}
        >
          <Icon name="capture" size={20} /> {s.start}
        </Button>
        <p class="ss-muted ss-startcard__keys">
          {s.shortcutLabel}: <kbd>{shortcut}</kbd>
        </p>
        {error ? (
          <p class="ss-error" role="alert">
            {error}
          </p>
        ) : (
          <p class="ss-muted">{s.permissionNote}</p>
        )}
      </div>

      <PagePanel libraryVersion={libraryVersion} />

      <section aria-labelledby="recent-h" class="ss-recent">
        <h2 id="recent-h">{s.recent}</h2>
        {recent.length ? (
          <ul class="ss-guidelist">
            {recent.map((g) => (
              <li key={g.id}>
                <button type="button" class="ss-guidelist__title" onClick={() => openLibrary(g.id)}>
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

/** A web page's host name; empty for other pages (the extension's own, chrome:, files). */
function hostOf(url: string | undefined): string {
  try {
    const u = new URL(url ?? '');
    return /^https?:$/.test(u.protocol) ? u.hostname : '';
  } catch {
    return '';
  }
}

/** The site being recorded, from the active tab. */
function SiteChip() {
  const tab = useActiveTab();
  const host = hostOf(tab.url);
  if (!host) return null;
  const icon =
    tab.favIconUrl && /^(https?:|data:image\/)/.test(tab.favIconUrl) ? tab.favIconUrl : undefined;
  return <Chip label={host} icon={icon} title={c.site(host)} />;
}

function Recording({ state }: { state: CaptureState }) {
  const [confirming, setConfirming] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const head = useRef<HTMLElement>(null);
  const paused = state.status === 'paused';
  const control = (action: ControlAction) => void request({ type: 'control', action });

  useEffect(() => {
    const onScroll = () => setScrolled(scrollY > 4);
    addEventListener('scroll', onScroll, { passive: true });
    // Cards scrolled into view stop below the sticky header, never under it.
    const root = document.documentElement;
    const size = new ResizeObserver(() => {
      root.style.scrollPaddingTop = `${(head.current?.offsetHeight ?? 0) + 12}px`;
    });
    if (head.current) size.observe(head.current);
    return () => {
      removeEventListener('scroll', onScroll);
      size.disconnect();
      root.style.scrollPaddingTop = '';
    };
  }, []);

  return (
    <main class="ss-sidepanel ss-sidepanel--recording">
      <header ref={head} class={`ss-rec-head${scrolled ? ' is-scrolled' : ''}`}>
        <div class="ss-rec-bar">
          <section class="ss-status" aria-live="polite">
            <span class={`ss-dot${paused ? ' ss-dot--paused' : ''}`} aria-hidden="true" />
            <strong>{paused ? c.paused : c.recording}</strong>
            <span class="ss-muted">{c.steps(state.stepCount)}</span>
          </section>
          <IconButton
            icon={paused ? 'play' : 'pause'}
            label={paused ? c.resume : c.pause}
            onClick={() => control(paused ? 'resume' : 'pause')}
          />
          <IconButton
            icon={state.liveBlur ? 'eye-off' : 'blur'}
            label={c.liveBlur}
            aria-pressed={state.liveBlur}
            onClick={() => control('toggle-live-blur')}
          />
          <Menu
            label={c.moreActions}
            items={[
              { label: c.cancelRecording, danger: true, onSelect: () => setConfirming(true) },
            ]}
          />
          <Button variant="signal" onClick={() => control('finish')}>
            <Icon name="finish" /> {c.finish}
          </Button>
        </div>
        {state.title ? <p class="ss-rec-title">{state.title}</p> : null}
        <SiteChip />
        {state.liveBlur ? <p class="ss-rec-hint">{c.liveBlurOn}</p> : null}
      </header>
      {confirming ? (
        <Dialog
          title={c.cancelTitle}
          onClose={() => setConfirming(false)}
          actions={
            <>
              <Button onClick={() => setConfirming(false)}>{c.keepRecording}</Button>
              <Button variant="danger" onClick={() => control('cancel')}>
                {c.discardCapture}
              </Button>
            </>
          }
        >
          <p>{c.cancelConfirm}</p>
        </Dialog>
      ) : null}
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
      <h2 id="rec-steps-h" class="ss-sr">
        {c.stepsTitle}
      </h2>
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
                  <IconButton
                    icon="trash"
                    size="sm"
                    class="ss-rec-step__delete"
                    label={c.deleteStep(n)}
                    onClick={() => void request({ type: 'delete-step', stepId: step.id })}
                  />
                </div>
                {step.human.screenshot && guide ? (
                  <Screenshot
                    store={getStore()}
                    guideId={guide.id}
                    step={step}
                    alt={title}
                    frame={16 / 10}
                  />
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
