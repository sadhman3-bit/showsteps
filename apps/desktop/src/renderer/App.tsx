import { exportGuideArchive, importGuideArchive, type Guide } from '@trailmark/core';
import {
  Button,
  Dialog,
  GuideEditor,
  GuideView,
  Icon,
  InputModeSelect,
  Insights,
  Library,
  PrintView,
  anyAi,
  detectAi,
  strings,
} from '@trailmark/ui';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  api,
  ipcStore,
  useLibraryVersion,
  usePushed,
  type CaptureView,
  type DesktopSettingsView,
} from './api';

type Route =
  | { page: 'library' }
  | { page: 'edit'; id: string }
  | { page: 'view'; id: string; stepId?: string }
  | { page: 'print'; id: string }
  | { page: 'insights' };

/** #/ · #/guide/<id> (editor) · #/guide/<id>/view · #/guide/<id>/step/<stepId> · …/print · #/insights */
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
const guideHash = (id: string, sub = '') => `#/guide/${encodeURIComponent(id)}${sub}`;
const d = strings.desktop;

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const [settings, setSettings] = useState<DesktopSettingsView>();
  const [showSettings, setShowSettings] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [notice, setNotice] = useState('');
  const libraryVersion = useLibraryVersion();
  const capture = usePushed<CaptureView>(
    'capture-state',
    { status: 'idle', stepCount: 0, shared: false },
    () => api().invoke('capture:state'),
  );
  const bridge = usePushed<{ connected: boolean }>('bridge-state', { connected: false }, () =>
    api().invoke('bridge:state'),
  );
  // A new store object when the library switches, so views reload.
  const store = useMemo(
    () => ipcStore('active'),
    [settings?.active, settings?.libraryPath, settings?.sharedPath],
  );
  const inTeam = settings?.active === 'shared';

  useEffect(() => {
    void api()
      .invoke('settings:get')
      .then((s) => setSettings(s as DesktopSettingsView));
    void detectAi().then((c) => setAiAvailable(anyAi(c)));
    const onHash = () => setRoute(parseRoute(location.hash));
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const save = async (patch: Partial<DesktopSettingsView>) => {
    setSettings((await api().invoke('settings:set', patch)) as DesktopSettingsView);
  };

  /** L6: a read-only team guide is edited as a personal copy. */
  const copyToMine = async (g: Guide) => {
    const bytes = await exportGuideArchive(store, g.id);
    const { guideId } = await importGuideArchive(ipcStore('personal'), bytes);
    const mine = ipcStore('personal');
    const copy = await mine.getGuide(guideId);
    if (copy?.readOnly) {
      const { readOnly: _r, ...rest } = copy;
      await mine.saveGuide(rest);
    }
    await save({ active: 'personal' });
    setNotice(strings.readOnly.copied(g.title));
    go(guideHash(guideId));
  };

  const bar = (
    <header class="tm-desktopbar">
      {capture.status === 'idle' ? (
        <Button variant="primary" onClick={() => void api().invoke('capture:start')}>
          <Icon name="record" /> {d.record}
        </Button>
      ) : (
        <>
          <span class="tm-desktopbar__rec" role="status">
            <span class="tm-dot" aria-hidden="true" /> {d.recording(capture.stepCount)}
          </span>
          <Button variant="primary" onClick={() => void api().invoke('capture:control', 'finish')}>
            {d.finish}
          </Button>
        </>
      )}
      <span class="tm-muted tm-desktopbar__hint">
        {capture.shared ? d.shared : d.recordHint('Ctrl+Alt+R')}
      </span>
      <span class="tm-desktopbar__spacer" />
      {settings?.sharedAvailable ? (
        <div class="tm-segmented" role="group" aria-label={strings.library.title}>
          <button
            type="button"
            aria-pressed={!inTeam}
            onClick={() => void save({ active: 'personal' })}
          >
            {d.myLibrary}
          </button>
          <button
            type="button"
            aria-pressed={inTeam}
            onClick={() => void save({ active: 'shared' })}
          >
            {d.teamLibrary}
          </button>
        </div>
      ) : null}
      <span
        class={`tm-bridge${bridge.connected ? ' is-on' : ''}`}
        title={bridge.connected ? d.connected : d.notConnected}
      >
        {bridge.connected ? d.connected : d.notConnected}
      </span>
    </header>
  );

  const settingsDialog =
    showSettings && settings ? (
      <DesktopSettings
        value={settings}
        aiAvailable={aiAvailable}
        onClose={() => setShowSettings(false)}
        onSave={(v) => {
          setShowSettings(false);
          void save(v);
        }}
      />
    ) : null;

  let body;
  if (route.page === 'edit') {
    body = (
      <GuideEditorOrReadOnly
        key={route.id}
        id={route.id}
        store={store}
        inTeam={inTeam}
        user={settings?.userName ?? ''}
        aiEnabled={!!settings?.aiEnabled}
        libraryVersion={libraryVersion}
        onCopy={(g) => void copyToMine(g)}
      />
    );
  } else if (route.page === 'view') {
    body = (
      <GuideView
        key={route.id}
        store={store}
        guideId={route.id}
        refreshKey={libraryVersion}
        {...(route.stepId ? { focusStepId: route.stepId } : {})}
        onBack={() => go('#/')}
        onEdit={() => go(guideHash(route.id))}
        onPrint={() => go(guideHash(route.id, '/print'))}
        onGuideMe={(g) => void api().invoke('guide:start', g.id)}
        user={settings?.userName ?? 'Me'}
      />
    );
  } else if (route.page === 'print') {
    body = (
      <PrintView
        key={route.id}
        store={store}
        guideId={route.id}
        onBack={() => (history.length > 1 ? history.back() : go(guideHash(route.id)))}
      />
    );
  } else if (route.page === 'insights') {
    body = (
      <Insights
        store={store}
        refreshKey={libraryVersion}
        onBack={() => go('#/')}
        onOpen={(id) => go(guideHash(id, '/view'))}
      />
    );
  } else {
    body = (
      <Library
        key={settings?.active}
        store={store}
        refreshKey={libraryVersion}
        onOpen={(id) => go(guideHash(id))}
        onInsights={() => go('#/insights')}
        onSettings={() => setShowSettings(true)}
      />
    );
  }

  return (
    <div class="tm-desktop">
      {bar}
      {notice ? (
        <p class="tm-notice tm-desktop__notice" role="status">
          {notice}
        </p>
      ) : null}
      {body}
      {settingsDialog}
    </div>
  );
}

/** Team guides marked read-only open in the reader with "Edit a personal copy" (L6). */
function GuideEditorOrReadOnly(props: {
  id: string;
  store: ReturnType<typeof ipcStore>;
  inTeam: boolean;
  user: string;
  aiEnabled: boolean;
  libraryVersion: number;
  onCopy: (g: Guide) => void;
}) {
  const [guide, setGuide] = useState<Guide | null>();
  useEffect(() => {
    void props.store.getGuide(props.id).then((g) => setGuide(g ?? null));
  }, [props.store, props.id]);
  if (guide === undefined) return <main class="tm-page" aria-busy="true" />;
  if (guide && guide.readOnly && props.inTeam) {
    return (
      <>
        <div class="tm-notice tm-readonly" role="status">
          <strong>{strings.readOnly.badge}</strong> {strings.readOnly.notice}{' '}
          <Button variant="primary" onClick={() => props.onCopy(guide)}>
            {strings.readOnly.copy}
          </Button>
        </div>
        <GuideView
          store={props.store}
          guideId={props.id}
          onBack={() => go('#/')}
          onGuideMe={(g) => void api().invoke('guide:start', g.id)}
          user={props.user}
        />
      </>
    );
  }
  return (
    <GuideEditor
      store={props.store}
      guideId={props.id}
      refreshKey={props.libraryVersion}
      aiEnabled={props.aiEnabled}
      onOpenGuide={(id) => go(guideHash(id))}
      onPrint={() => go(guideHash(props.id, '/print'))}
      onBack={() => go('#/')}
      {...(props.inTeam ? { readOnlyToggle: true } : {})}
    />
  );
}

/** Desktop settings: name, guidance, AI, and where the libraries live (L3). */
function DesktopSettings({
  value,
  aiAvailable,
  onSave,
  onClose,
}: {
  value: DesktopSettingsView;
  aiAvailable: boolean;
  onSave: (v: Partial<DesktopSettingsView>) => void;
  onClose: () => void;
}) {
  const s = strings.settings;
  const [draft, setDraft] = useState(value);
  const pick = async (key: 'libraryPath' | 'sharedPath') => {
    const path = (await api().invoke('pick-folder')) as string | undefined;
    if (path) setDraft({ ...draft, [key]: path });
  };
  return (
    <Dialog
      title={s.title}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{strings.library.cancel}</Button>
          <Button
            variant="primary"
            onClick={() =>
              onSave({
                userName: draft.userName.trim() || value.userName,
                guidanceEnabled: draft.guidanceEnabled,
                aiEnabled: draft.aiEnabled,
                defaultInputMode: draft.defaultInputMode,
                libraryPath: draft.libraryPath,
                sharedPath: draft.sharedPath,
                ...(draft.sharedPath ? {} : { active: 'personal' as const }),
              })
            }
          >
            {s.save}
          </Button>
        </>
      }
    >
      <div class="tm-stack-form">
        <label class="tm-field">
          {s.userName}
          <input
            class="tm-input"
            value={draft.userName}
            onInput={(e) => setDraft({ ...draft, userName: e.currentTarget.value })}
          />
          <small class="tm-muted">{s.userNameHint}</small>
        </label>
        <div class="tm-field">
          <span>{d.libraryFolder}</span>
          <code class="tm-path">{draft.libraryPath}</code>
          <Button onClick={() => void pick('libraryPath')}>{d.choose}</Button>
        </div>
        <div class="tm-field">
          <span>{d.sharedFolder}</span>
          <code class="tm-path">{draft.sharedPath || d.sharedNone}</code>
          <div class="tm-row">
            <Button onClick={() => void pick('sharedPath')}>{d.choose}</Button>
            {draft.sharedPath ? (
              <Button variant="ghost" onClick={() => setDraft({ ...draft, sharedPath: '' })}>
                {d.clear}
              </Button>
            ) : null}
          </div>
        </div>
        <label class="tm-field">
          {s.inputMode}
          <InputModeSelect
            value={draft.defaultInputMode}
            onChange={(mode) => setDraft({ ...draft, defaultInputMode: mode })}
          />
          <small class="tm-muted">{s.inputModeHint}</small>
        </label>
        <label class="tm-check">
          <input
            type="checkbox"
            checked={draft.guidanceEnabled}
            onChange={(e) => setDraft({ ...draft, guidanceEnabled: e.currentTarget.checked })}
          />{' '}
          {s.guidance}
        </label>
        {aiAvailable ? (
          <label class="tm-check">
            <input
              type="checkbox"
              checked={draft.aiEnabled}
              onChange={(e) => setDraft({ ...draft, aiEnabled: e.currentTarget.checked })}
            />{' '}
            {s.ai}
          </label>
        ) : null}
      </div>
    </Dialog>
  );
}
