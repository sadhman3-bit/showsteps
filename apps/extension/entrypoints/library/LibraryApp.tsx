import { stepNumbers, toPlainText } from '@trailmark/core';
import { GuideEditor, GuideView, Library } from '@trailmark/ui';
import { useEffect, useState } from 'preact/hooks';
import {
  getStore,
  stepUrl,
  useBackground,
  writeCaptureMore,
  writeRecapture,
} from '../../lib/client';
import { installSamples } from '../../lib/samples';

type Route =
  | { page: 'library' }
  | { page: 'edit'; id: string }
  | { page: 'view'; id: string; stepId?: string };

/** Hash routes: #/ · #/guide/<id> (editor) · #/guide/<id>/view · #/guide/<id>/step/<stepId> (reader). */
export function parseRoute(hash: string): Route {
  const m = /^#\/guide\/([^/?]+)(?:\/(view|step)(?:\/([^/?]+))?)?/.exec(hash);
  if (!m?.[1]) return { page: 'library' };
  const id = decodeURIComponent(m[1]);
  if (m[2] === 'step' && m[3]) return { page: 'view', id, stepId: decodeURIComponent(m[3]) };
  if (m[2] === 'view') return { page: 'view', id };
  return { page: 'edit', id };
}

const go = (hash: string) => (location.hash = hash);

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

  if (route.page === 'edit') {
    return (
      <GuideEditor
        key={route.id}
        store={store}
        guideId={route.id}
        refreshKey={libraryVersion}
        stepLink={stepUrl}
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
      <GuideView
        key={route.id}
        store={store}
        guideId={route.id}
        refreshKey={libraryVersion}
        stepLink={stepUrl}
        {...(route.stepId ? { focusStepId: route.stepId } : {})}
        onBack={() => go('#/')}
        onEdit={() => go(`#/guide/${encodeURIComponent(route.id)}`)}
      />
    );
  }
  return (
    <Library
      store={store}
      refreshKey={libraryVersion}
      onOpen={(id) => go(`#/guide/${encodeURIComponent(id)}`)}
      onAddSamples={() => installSamples(store)}
    />
  );
}
