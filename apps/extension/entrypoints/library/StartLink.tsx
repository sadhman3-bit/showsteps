import { guideVersion, type Guide, type GuideStore, type StartMode } from '@showsteps/core';
import { Button, Icon, RunDialog, strings, type RunOptions } from '@showsteps/ui';
import { useEffect, useState } from 'preact/hooks';
import { guideRequest, startError, startGuide } from '../../lib/client';

const s = strings.startLink;

export interface StartLinkRoute {
  guideId: string;
  mode: StartMode;
  /** The tab the link opened. */
  tabId: number;
  /** `guideVersion` of the copy the file was made from. */
  version: string;
}

/** `#/start/<id>?mode=guide|run&tab=<tabId>&v=<version>`, or undefined. */
export function parseStartRoute(hash: string): StartLinkRoute | undefined {
  const m = /^#\/start\/([^/?]+)\?(.*)$/.exec(hash);
  if (!m?.[1]) return undefined;
  const q = new URLSearchParams(m[2]);
  const mode = q.get('mode');
  const tabId = Number(q.get('tab'));
  if ((mode !== 'guide' && mode !== 'run') || !Number.isInteger(tabId) || tabId < 0)
    return undefined;
  try {
    return { guideId: decodeURIComponent(m[1]), mode, tabId, version: q.get('v') ?? '' };
  } catch {
    return undefined;
  }
}

/**
 * The window a Guide Me or Run for me link in an exported file opens (1.2): the guide, what will
 * happen, and Start or Not now. Being an extension page, the website can't cover or click it.
 */
export function StartLinkPage({ store, link }: { store: GuideStore; link: StartLinkRoute }) {
  const [guide, setGuide] = useState<Guide | null>();
  const [windowId, setWindowId] = useState<number>();
  const [error, setError] = useState('');
  useEffect(() => {
    void store.getGuide(link.guideId).then(
      (g) => setGuide(g ?? null),
      () => setGuide(null),
    );
    void browser.tabs.get(link.tabId).then(
      (tab) => setWindowId(tab.windowId),
      () => setError(s.tabGone),
    );
  }, [link.guideId, link.tabId]);

  const close = () => window.close();
  const notNow = () =>
    void guideRequest({ type: 'start-link-dismiss', tabId: link.tabId }).finally(close);

  /** Inside the click: the side panel opens in the page's window, then guidance starts there. */
  const start = (run?: RunOptions) => {
    if (windowId !== undefined) void browser.sidePanel.open({ windowId }).catch(() => undefined);
    setError('');
    void startGuide({
      guideId: link.guideId,
      mode: link.mode,
      tabId: link.tabId,
      ...(windowId !== undefined ? { windowId } : {}),
      ...(run ?? {}),
      fromLink: true,
    }).then((err) => (err ? setError(startError(err)) : close()));
  };

  const changed =
    guide && link.version && guideVersion(guide) !== link.version ? (
      <p class="ss-callout" role="note">
        <Icon name="info" />
        <span>{s.changed(link.mode)}</span>
      </p>
    ) : null;
  const errorLine = error ? (
    <p class="ss-error" role="alert">
      {error}
    </p>
  ) : null;

  return (
    <main class="ss-page ss-start">
      <h1>{s.title}</h1>
      {guide === null ? (
        <>
          <p>{s.missing}</p>
          <div class="ss-start__buttons">
            <Button
              variant="primary"
              onClick={() => {
                void browser.tabs.create({ url: browser.runtime.getURL('/library.html') });
                close();
              }}
            >
              {s.openLibrary}
            </Button>
            <Button onClick={close}>{s.close}</Button>
          </div>
        </>
      ) : guide ? (
        <>
          <h2>{guide.title}</h2>
          <p>{link.mode === 'run' ? s.runForMe(guide.title) : s.guideMe(guide.title)}</p>
          {errorLine}
          {link.mode === 'guide' ? (
            <>
              {changed}
              <div class="ss-start__buttons">
                <Button variant="primary" onClick={() => start()}>
                  {s.start}
                </Button>
                <Button onClick={notNow}>{s.notNow}</Button>
              </div>
            </>
          ) : (
            <RunDialog
              guide={guide}
              cancelLabel={s.notNow}
              {...(changed ? { notice: changed } : {})}
              onClose={notNow}
              onStart={start}
            />
          )}
        </>
      ) : null}
    </main>
  );
}
