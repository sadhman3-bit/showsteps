import {
  createId,
  fromMarkdown,
  nowIso,
  pageKey,
  relevantGuides,
  toMarkdown,
  toPlainText,
  type GuideSummary,
  type PageMark,
  type Target,
} from '@showsteps/core';
import { Button, strings } from '@showsteps/ui';
import { useEffect, useState } from 'preact/hooks';
import {
  getStore,
  guideRequest,
  startGuide,
  useActiveTab,
  useGuideBroadcast,
} from '../../lib/client';
import type { Settings } from '../../lib/guideMessages';
import { readMarks, readSettings, writeSettings } from '../../lib/settings';

const g = strings.guidance;
const d = strings.discover;
const m = strings.marks;

interface Draft {
  id?: string;
  kind: PageMark['kind'];
  tone: PageMark['tone'];
  text: string;
  href: string;
  guideId: string;
  page: string;
  frameUrl?: string;
  target?: Target;
  createdAt?: string;
}

/** Discover (guides for this site), notes and pins on this page, and the Guidance switch. */
export function PagePanel({ libraryVersion }: { libraryVersion: number }) {
  const tab = useActiveTab();
  const [guides, setGuides] = useState<GuideSummary[]>([]);
  const [marks, setMarks] = useState<PageMark[]>([]);
  const [settings, setSettings] = useState<Settings>();
  const [picking, setPicking] = useState<PageMark['kind'] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const page = pageKey(tab.url ?? '');

  useEffect(() => {
    void getStore()
      .listGuides()
      .then(setGuides)
      .catch(() => setGuides([]));
  }, [libraryVersion]);

  const loadMarks = () => void readMarks().then(setMarks);
  useEffect(() => {
    loadMarks();
    void readSettings().then(setSettings);
  }, []);

  useGuideBroadcast((msg) => {
    if (msg.type === 'marks-changed') loadMarks();
    if (msg.type === 'picked' && picking && msg.tabId === tab.id) {
      const kind = picking;
      setPicking(null);
      if (msg.cancelled) return;
      setDraft({
        kind,
        tone: 'tip',
        text: '',
        href: '',
        guideId: kind === 'pin' ? (relevant[0]?.id ?? guides[0]?.id ?? '') : '',
        page: msg.page,
        ...(msg.frameUrl ? { frameUrl: msg.frameUrl } : {}),
        ...(msg.target ? { target: msg.target } : {}),
      });
    }
  });

  const relevant = tab.url ? relevantGuides(guides, tab.url) : [];
  const here = marks.filter((x) => x.page === page);
  const titleOf = (id: string | undefined) => guides.find((x) => x.id === id)?.title ?? '';

  const guideMe = async (guideId: string) => {
    setError('');
    if (tab.windowId !== undefined)
      void browser.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
    const err = await startGuide({
      guideId,
      mode: 'guide',
      ...(tab.id !== undefined ? { tabId: tab.id } : {}),
      ...(tab.windowId !== undefined ? { windowId: tab.windowId } : {}),
    });
    if (err)
      setError(
        err === 'permission-needed'
          ? g.permission
          : err === 'no-web-steps'
            ? g.noWebSteps
            : g.startFailed,
      );
  };

  const pick = async (kind: PageMark['kind']) => {
    setError('');
    if (tab.id === undefined || !page) return;
    const granted = await browser.permissions.request({ origins: ['<all_urls>'] });
    if (!granted) {
      setError(g.permission);
      return;
    }
    setPicking(kind);
    await guideRequest({ type: 'pick-start', tabId: tab.id });
  };

  const cancelPick = () => {
    if (tab.id !== undefined) void guideRequest({ type: 'pick-cancel', tabId: tab.id });
    setPicking(null);
  };

  const save = async (e: Event) => {
    e.preventDefault();
    if (!draft) return;
    const href = draft.href.trim();
    if (href && !/^(https?:|mailto:)/i.test(href)) {
      setError(m.invalidLink);
      return;
    }
    const at = nowIso();
    const mark: PageMark = {
      id: draft.id ?? createId(),
      kind: draft.kind,
      tone: draft.kind === 'pin' ? 'link' : draft.tone,
      page: draft.page,
      ...(draft.frameUrl ? { frameUrl: draft.frameUrl } : {}),
      ...(draft.target ? { target: draft.target } : {}),
      text: fromMarkdown(draft.text.trim()),
      ...(href ? { href } : {}),
      ...(draft.guideId ? { guideId: draft.guideId } : {}),
      createdAt: draft.createdAt ?? at,
      updatedAt: at,
    };
    await guideRequest({ type: 'mark-save', mark });
    setDraft(null);
    setError('');
  };

  const edit = (x: PageMark) =>
    setDraft({
      id: x.id,
      kind: x.kind,
      tone: x.tone,
      text: toMarkdown(x.text),
      href: x.href ?? '',
      guideId: x.guideId ?? '',
      page: x.page,
      ...(x.frameUrl ? { frameUrl: x.frameUrl } : {}),
      ...(x.target ? { target: x.target } : {}),
      createdAt: x.createdAt,
    });

  const toggleGuidance = async (on: boolean) => {
    const next = { ...(settings ?? (await readSettings())), guidanceEnabled: on };
    await writeSettings(next);
    setSettings(next);
    await guideRequest({ type: 'settings-changed' });
  };

  return (
    <>
      <label class="ss-switch">
        <input
          type="checkbox"
          role="switch"
          class="ss-toggle"
          checked={settings?.guidanceEnabled ?? true}
          onChange={(e) => void toggleGuidance(e.currentTarget.checked)}
        />{' '}
        {strings.settings.guidance}
      </label>

      {error ? (
        <p class="ss-error" role="alert">
          {error}
        </p>
      ) : null}

      {settings?.guidanceEnabled !== false ? (
        <section aria-labelledby="discover-h" class="ss-recent">
          <h2 id="discover-h">{d.heading}</h2>
          {!page ? (
            <p class="ss-muted">{d.noSite}</p>
          ) : relevant.length ? (
            <ul>
              {relevant.slice(0, 8).map((x) => (
                <li key={x.id} class="ss-discover">
                  <span>{x.title}</span>
                  <Button onClick={() => void guideMe(x.id)}>{g.guideMe}</Button>
                </li>
              ))}
            </ul>
          ) : (
            <p class="ss-muted">{d.none}</p>
          )}
        </section>
      ) : null}

      {page ? (
        <section aria-labelledby="marks-h" class="ss-recent">
          <h2 id="marks-h">{m.heading}</h2>
          {here.length ? (
            <ul>
              {here.map((x) => (
                <li key={x.id} class="ss-mark">
                  <span>
                    <strong>{x.kind === 'pin' ? m.pin : m.tones[x.tone]}</strong>{' '}
                    {x.kind === 'pin' ? titleOf(x.guideId) : toPlainText(x.text)}
                  </span>
                  <span class="ss-muted">
                    {x.target
                      ? m.attachedTo(
                          x.target.name || x.target.label || x.target.text || x.target.role || '',
                        )
                      : m.onPage}
                  </span>
                  <span class="ss-mark__actions">
                    <button type="button" class="ss-link" onClick={() => edit(x)}>
                      {m.edit}
                    </button>
                    <button
                      type="button"
                      class="ss-link"
                      onClick={() => void guideRequest({ type: 'mark-delete', id: x.id })}
                    >
                      {m.delete}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="ss-muted">{m.none}</p>
          )}
          {picking ? (
            <div class="ss-notice ss-stack" role="status">
              <span>{m.pickHint}</span>
              <Button variant="ghost" onClick={cancelPick}>
                {m.cancel}
              </Button>
            </div>
          ) : draft ? (
            <form class="ss-stack ss-markform" onSubmit={(e) => void save(e)}>
              {draft.kind === 'note' ? (
                <>
                  <div class="ss-field">
                    <label for="ss-mark-tone">{m.tone}</label>
                    <select
                      id="ss-mark-tone"
                      class="ss-input"
                      value={draft.tone}
                      onChange={(e) =>
                        setDraft({ ...draft, tone: e.currentTarget.value as PageMark['tone'] })
                      }
                    >
                      {(Object.keys(m.tones) as PageMark['tone'][]).map((t) => (
                        <option key={t} value={t}>
                          {m.tones[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div class="ss-field">
                    <label for="ss-mark-text">{m.text}</label>
                    <textarea
                      id="ss-mark-text"
                      class="ss-input"
                      rows={3}
                      value={draft.text}
                      onInput={(e) => setDraft({ ...draft, text: e.currentTarget.value })}
                    />
                  </div>
                  <div class="ss-field">
                    <label for="ss-mark-link">{m.link}</label>
                    <input
                      id="ss-mark-link"
                      class="ss-input"
                      type="url"
                      value={draft.href}
                      onInput={(e) => setDraft({ ...draft, href: e.currentTarget.value })}
                    />
                  </div>
                </>
              ) : null}
              <div class="ss-field">
                <label for="ss-mark-guide">{m.guide}</label>
                <select
                  id="ss-mark-guide"
                  class="ss-input"
                  value={draft.guideId}
                  required={draft.kind === 'pin'}
                  onChange={(e) => setDraft({ ...draft, guideId: e.currentTarget.value })}
                >
                  {draft.kind === 'note' ? <option value="">{m.noGuide}</option> : null}
                  {guides
                    .filter((x) => !x.trashedAt)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.title}
                      </option>
                    ))}
                </select>
              </div>
              <div class="ss-row">
                <Button variant="primary" type="submit">
                  {m.save}
                </Button>
                <Button variant="ghost" onClick={() => setDraft(null)}>
                  {m.cancel}
                </Button>
              </div>
            </form>
          ) : (
            <div class="ss-row">
              <Button onClick={() => void pick('note')}>{m.addNote}</Button>
              <Button onClick={() => void pick('pin')}>{m.pinGuide}</Button>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
