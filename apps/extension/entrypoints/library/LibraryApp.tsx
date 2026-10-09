import { GuideView, Library } from '@trailmark/ui';
import { useEffect, useState } from 'preact/hooks';
import { getStore, useBackground, writeCaptureMore } from '../../lib/client';

type Route = { page: 'library' } | { page: 'guide'; id: string };

function parseRoute(hash: string): Route {
  const m = /^#\/guide\/([^/?]+)/.exec(hash);
  return m?.[1] ? { page: 'guide', id: decodeURIComponent(m[1]) } : { page: 'library' };
}

/** Full-page library (opened in a tab). Hash routes: #/ and #/guide/<id>. */
export function LibraryApp() {
  const store = getStore();
  const { libraryVersion } = useBackground();
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  // Known in advance: sidePanel.open must run synchronously inside the click.
  const [windowId, setWindowId] = useState<number>();
  useEffect(() => {
    void browser.windows.getCurrent().then((w) => setWindowId(w.id));
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash));
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  if (route.page === 'guide') {
    return (
      <GuideView
        store={store}
        guideId={route.id}
        refreshKey={libraryVersion}
        onBack={() => (location.hash = '#/')}
        onCaptureMore={(guide, insertAt) => {
          // Hand over to the side panel, which records into the tab the user picks.
          const afterStep = guide.blocks.slice(0, insertAt).filter((b) => b.kind === 'step').length;
          void writeCaptureMore({ guideId: guide.id, title: guide.title, insertAt, afterStep });
          if (windowId !== undefined)
            void browser.sidePanel.open({ windowId }).catch(() => undefined);
        }}
      />
    );
  }
  return (
    <Library
      store={store}
      refreshKey={libraryVersion}
      onOpen={(id) => (location.hash = `#/guide/${encodeURIComponent(id)}`)}
    />
  );
}
