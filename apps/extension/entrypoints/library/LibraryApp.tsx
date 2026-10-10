import { stepNumbers, toPlainText } from '@trailmark/core';
import type { Guide } from '@trailmark/core';
import {
  GuideEditor,
  GuideView,
  Insights,
  Library,
  PrintView,
  SettingsDialog,
  anyAi,
  detectAi,
  strings,
  type RunSpeed,
} from '@trailmark/ui';
import { useEffect, useState } from 'preact/hooks';
import {
  getStore,
  stepUrl,
  startGuide,
  useBackground,
  writeCaptureMore,
  writeRecapture,
} from '../../lib/client';
import { DEFAULT_SETTINGS, SETTINGS_KEY, type Settings } from '../../lib/guideMessages';
import { installSamples } from '../../lib/samples';
import { readSettings, writeSettings } from '../../lib/settings';

type Route =
  | { page: 'library' }
  | { page: 'edit'; id: string }
  | { page: 'view'; id: string; stepId?: string }
  | { page: 'print'; id: string }
  | { page: 'insights' };

/**
 * Hash routes: #/ · #/guide/<id> (editor) · #/guide/<id>/view · #/guide/<id>/step/<stepId>
 * (reader) · #/guide/<id>/print · #/insights.
 */
export function parseRoute(hash: string): Route {
  if (hash.startsWith('#/insights')) return { page: 'insights' };
  const m = /^#\/guide\/([^/?]+)(?:\/(view|step|print)(?:\/([^/?]+))?)?/.exec(hash);
  if (!m?.[1]) return { page: 'library' };
  const id = decodeURIComponent(m[1]);
  if (m[2] === 'step' && m[3]) return { page: 'view', id, stepId: decodeURIComponent(m[3]) };
  if (m[2] === 'view') return { page: 'view', id };
  if (m[2] === 'print') return { page: 'print', id };
  return { page: 'edit', id };
}

const go = (hash: string) => (location.hash = hash);
const printRoute = (id: string) => `#/guide/${encodeURIComponent(id)}/print`;

/** Full-page library (opened in a tab). */
export function LibraryApp() {
  const store = getStore();
  const { libraryVersion } = useBackground();
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  // Known in advance: sidePanel.open must run synchronously inside the click.
  const [windowId, setWindowId] = useState<number>();

  useEffect(() => {
    void browser.windows.getCurrent().then((w) => setWindowId(w.id));
    const onHash = () => setRoute(parseRoute(location.hash));
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const openSidePanel = () => {
    if (windowId !== undefined) void browser.sidePanel.open({ windowId }).catch(() => undefined);
  };

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    void readSettings().then(setSettings);
    void detectAi().then((c) => setAiAvailable(anyAi(c)));
    const onChange = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && SETTINGS_KEY in changes) void readSettings().then(setSettings);
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);

  /** Guide Me / Run for me: the side panel opens beside the page (inside this click). */
  const guide = (
    g: Guide,
    mode: 'guide' | 'run',
    run?: { values: Record<string, string>; speed: RunSpeed; stepThrough: boolean },
  ) => {
    openSidePanel();
    setNotice('');
    void startGuide({
      guideId: g.id,
      mode,
      ...(windowId !== undefined ? { windowId } : {}),
      ...(run ?? {}),
    }).then((error) => {
      if (error)
        setNotice(
          error === 'permission-needed'
            ? strings.guidance.permission
            : error === 'no-web-steps'
              ? strings.guidance.noWebSteps
              : strings.guidance.startFailed,
        );
    });
  };

  const settingsDialog = showSettings ? (
    <SettingsDialog
      value={settings}
      aiAvailable={aiAvailable}
      onClose={() => setShowSettings(false)}
      onSave={(value) => {
        setShowSettings(false);
        void writeSettings(value).then(() => {
          setSettings(value);
          void browser.runtime.sendMessage({ type: 'settings-changed' }).catch(() => undefined);
        });
      }}
    />
  ) : null;
  const noticeBar = notice ? (
    <p class="tm-toast" role="alert">
      {notice}
    </p>
  ) : null;

  if (route.page === 'edit') {
    return (
      <GuideEditor
        key={route.id}
        store={store}
        guideId={route.id}
        refreshKey={libraryVersion}
        stepLink={stepUrl}
        onPrint={() => go(printRoute(route.id))}
        aiEnabled={settings.aiEnabled}
        onOpenGuide={(id) => go(`#/guide/${encodeURIComponent(id)}`)}
        onBack={() => go('#/')}
        onCaptureMore={(guide, insertAt) => {
          // Hand over to the side panel, which records into the tab the user picks.
          const afterStep = guide.blocks.slice(0, insertAt).filter((b) => b.kind === 'step').length;
          void writeCaptureMore({ guideId: guide.id, title: guide.title, insertAt, afterStep });
          openSidePanel();
        }}
        onRecapture={(guide, stepId) => {
          const step = guide.blocks.find((b) => b.id === stepId);
          void writeRecapture({
            guideId: guide.id,
            stepId,
            title: step?.kind === 'step' ? toPlainText(step.human.title) : '',
            stepNumber: stepNumbers(guide).get(stepId) ?? 1,
          });
          openSidePanel();
        }}
      />
    );
  }
  if (route.page === 'view') {
    return (
      <>
        {noticeBar}
        <GuideView
          key={route.id}
          store={store}
          guideId={route.id}
          refreshKey={libraryVersion}
          stepLink={stepUrl}
          {...(route.stepId ? { focusStepId: route.stepId } : {})}
          onBack={() => go('#/')}
          onEdit={() => go(`#/guide/${encodeURIComponent(route.id)}`)}
          onPrint={() => go(printRoute(route.id))}
          onGuideMe={(g) => guide(g, 'guide')}
          onRunForMe={(g, run) => guide(g, 'run', run)}
          user={settings.userName}
        />
      </>
    );
  }
  if (route.page === 'insights') {
    return (
      <Insights
        store={store}
        refreshKey={libraryVersion}
        onBack={() => go('#/')}
        onOpen={(id) => go(`#/guide/${encodeURIComponent(id)}/view`)}
      />
    );
  }
  if (route.page === 'print') {
    return (
      <PrintView
        key={route.id}
        store={store}
        guideId={route.id}
        onBack={() =>
          history.length > 1 ? history.back() : go(`#/guide/${encodeURIComponent(route.id)}`)
        }
      />
    );
  }
  return (
    <>
      <Library
        store={store}
        refreshKey={libraryVersion}
        onOpen={(id) => go(`#/guide/${encodeURIComponent(id)}`)}
        onAddSamples={() => installSamples(store)}
        onInsights={() => go('#/insights')}
        onSettings={() => setShowSettings(true)}
      />
      {settingsDialog}
    </>
  );
}
