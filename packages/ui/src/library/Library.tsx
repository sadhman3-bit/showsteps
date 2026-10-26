import {
  ARCHIVE_ACCEPT,
  ARCHIVE_EXTENSION,
  createId,
  duplicateGuide,
  exportGuideArchive,
  importGuideArchive,
  type Folder,
  type GuideStore,
  type GuideSummary,
} from '@showsteps/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { ConfirmDialog, Dialog, PromptDialog } from '../components/Dialog.js';
import { LOCKUP_SVG, MARK_SVG } from '../brand/art.js';
import { Chip } from '../components/Chip.js';
import { EmptyState } from '../components/EmptyState.js';
import { Icon } from '../components/Icon.js';
import { shareRedactor } from '../export/flatten.js';
import { downloadBytes, safeFileName, useImageUrl, usePreference } from '../hooks.js';
import { strings } from '../strings.js';
import { relativeTime } from '../time.js';
import {
  appLabel,
  facets,
  filterGuides,
  folderTree,
  parseTags,
  type Scope,
  type SortKey,
} from './filter.js';

const s = strings.library;

export interface LibraryProps {
  store: GuideStore;
  onOpen: (guideId: string) => void;
  /** Bumped by the host when guides change elsewhere (e.g. a capture finished). */
  refreshKey?: number;
  /** Offered when the library is empty: add the bundled sample guides. */
  onAddSamples?: () => Promise<unknown>;
  /** Open the usage dashboard (L5). */
  onInsights?: () => void;
  /** Open settings. */
  onSettings?: () => void;
  /** B4: Settings → Branding (brand kits). */
  onBranding?: () => void;
  /** Offered when the library is empty: start recording (opens the side panel). */
  onStartCapture?: () => void;
  /** Open the About dialog. */
  onAbout?: () => void;
  /** Open the Schedules page (S3). */
  onSchedules?: () => void;
  /** A scheduled run stopped or failed since the Schedules page was last opened. */
  schedulesAttention?: boolean;
  /** Set when a guide's Run for me runs (S3); offered on each card. */
  onSchedule?: (guideId: string) => void;
  /** Start Guide Me from a card (1.2). Called inside the click, so permissions can be asked. */
  onGuideMe?: (guideId: string) => void;
  /** Open Run for me's dialog for a guide (1.2). */
  onRunForMe?: (guideId: string) => void;
}

type Modal =
  | { kind: 'rename'; guide: GuideSummary }
  | { kind: 'tags'; guide: GuideSummary }
  | { kind: 'move'; guide: GuideSummary }
  | { kind: 'purge'; guide: GuideSummary }
  | { kind: 'backup'; guide: GuideSummary }
  | { kind: 'new-folder'; parentId?: string }
  | { kind: 'rename-folder'; folder: Folder }
  | { kind: 'delete-folder'; folder: Folder };

/** The guide library: folders, search, filters, grid/list, Trash, import and export. */
export function Library({
  store,
  onOpen,
  refreshKey,
  onAddSamples,
  onInsights,
  onSettings,
  onBranding,
  onStartCapture,
  onAbout,
  onSchedules,
  schedulesAttention,
  onSchedule,
  onGuideMe,
  onRunForMe,
}: LibraryProps) {
  const [guides, setGuides] = useState<GuideSummary[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [text, setText] = useState('');
  const [sort, setSort] = usePreference<SortKey>('library.sort', 'updated');
  const [view, setView] = usePreference<'grid' | 'list'>('library.view', 'grid');
  const [app, setApp] = useState('');
  const [tag, setTag] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);
  const [notice, setNotice] = useState<string>('');
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const [g, f] = await Promise.all([
      store.listGuides({ includeTrashed: true }),
      store.listFolders(),
    ]);
    setGuides(g);
    setFolders(f);
    setLoaded(true);
  }, [store]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const shown = useMemo(
    () =>
      filterGuides(guides, { scope, text, sort, ...(app ? { app } : {}), ...(tag ? { tag } : {}) }),
    [guides, scope, text, sort, app, tag],
  );
  const { apps, tags } = useMemo(() => facets(guides), [guides]);
  const tree = useMemo(() => folderTree(folders), [folders]);
  const inTrash = scope.kind === 'trash';
  const currentFolder =
    scope.kind === 'folder' ? folders.find((f) => f.id === scope.folderId) : undefined;

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) setNotice(done);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : strings.errors.generic);
    }
    setModal(null);
    await reload();
  };

  const updateGuide = (
    id: string,
    change: (g: NonNullable<Awaited<ReturnType<GuideStore['getGuide']>>>) => void,
  ) =>
    act(async () => {
      const guide = await store.getGuide(id);
      if (!guide) return;
      change(guide);
      await store.saveGuide(guide);
    });

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    await act(async () => {
      const result = await importGuideArchive(store, new Uint8Array(await file.arrayBuffer()), {
        received: { from: 'import', file: file.name },
      });
      if (scope.kind === 'folder') {
        const g = await store.getGuide(result.guideId);
        if (g) await store.saveGuide({ ...g, folderId: scope.folderId }, { snapshot: false });
      }
    }, s.importDone).catch(() => undefined);
    if (fileInput.current) fileInput.current.value = '';
  };

  /** Export: a file to give others, with blurs burned in and nothing hidden left in it (H1). */
  const exportGuide = (g: GuideSummary, mode: 'share' | 'backup' = 'share') =>
    act(async () => {
      const bytes = await exportGuideArchive(
        store,
        g.id,
        mode === 'share' ? { mode, redact: shareRedactor } : { mode },
      );
      const name = mode === 'share' ? g.title : s.backupName(g.title);
      downloadBytes(bytes, `${safeFileName(name)}${ARCHIVE_EXTENSION}`, 'application/zip');
    });

  return (
    <div class="ss-library">
      <aside class="ss-library__side" aria-label={s.folders}>
        <h1 class="ss-brand">
          <span
            class="ss-lockup"
            role="img"
            aria-label={strings.app.name}
            dangerouslySetInnerHTML={{ __html: LOCKUP_SVG }}
          />
        </h1>
        <nav>
          <ul class="ss-nav">
            <li>
              <button
                type="button"
                class="ss-nav__item"
                aria-current={scope.kind === 'all' ? 'page' : undefined}
                onClick={() => setScope({ kind: 'all' })}
              >
                <Icon name="stack" /> {s.allGuides}
              </button>
            </li>
            {tree.map(({ folder, depth }) => (
              <li key={folder.id}>
                <button
                  type="button"
                  class="ss-nav__item"
                  style={{ paddingInlineStart: `${12 + depth * 16}px` }}
                  aria-current={
                    scope.kind === 'folder' && scope.folderId === folder.id ? 'page' : undefined
                  }
                  onClick={() => setScope({ kind: 'folder', folderId: folder.id })}
                >
                  <Icon name="folder" /> {folder.name}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                class="ss-nav__item"
                aria-current={inTrash ? 'page' : undefined}
                onClick={() => setScope({ kind: 'trash' })}
              >
                <Icon name="trash" /> {s.trash}
              </button>
            </li>
          </ul>
        </nav>
        <Button
          variant="ghost"
          onClick={() =>
            setModal({
              kind: 'new-folder',
              ...(currentFolder ? { parentId: currentFolder.id } : {}),
            })
          }
        >
          <Icon name="plus" /> {s.newFolder}
        </Button>
        {onInsights ? (
          <Button variant="ghost" onClick={onInsights}>
            <Icon name="stack" /> {strings.insights.title}
          </Button>
        ) : null}
        {onSchedules ? (
          <Button variant="ghost" onClick={onSchedules}>
            <Icon name="clock" /> {strings.schedules.button}
            {schedulesAttention ? (
              <span class="ss-attention" role="img" aria-label={strings.schedules.attention} />
            ) : null}
          </Button>
        ) : null}
        {onBranding ? (
          <Button variant="ghost" onClick={onBranding}>
            <Icon name="palette" /> {strings.brandKits.button}
          </Button>
        ) : null}
        {onSettings ? (
          <Button variant="ghost" onClick={onSettings}>
            <Icon name="settings" /> {strings.settings.button}
          </Button>
        ) : null}
        {onAbout ? (
          <Button variant="ghost" onClick={onAbout}>
            <Icon name="help" /> {strings.about.button}
          </Button>
        ) : null}
      </aside>

      <main class="ss-library__main">
        <header class="ss-toolbar">
          <h2 class="ss-toolbar__title">
            {inTrash ? s.trash : (currentFolder?.name ?? s.allGuides)}
          </h2>
          {currentFolder ? (
            <div class="ss-toolbar__group">
              <Button
                variant="ghost"
                onClick={() => setModal({ kind: 'rename-folder', folder: currentFolder })}
              >
                {s.renameFolder}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setModal({ kind: 'delete-folder', folder: currentFolder })}
              >
                {s.deleteFolder}
              </Button>
            </div>
          ) : null}
          <div class="ss-toolbar__spacer" />
          <Button onClick={() => fileInput.current?.click()}>
            <Icon name="upload" /> {s.import}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept={ARCHIVE_ACCEPT}
            hidden
            aria-label={s.import}
            onChange={(e) => void onImportFile(e.currentTarget.files?.[0])}
          />
        </header>

        <div class="ss-filters" role="search">
          <label class="ss-search">
            <Icon name="search" />
            <span class="ss-sr">{s.search}</span>
            <input
              type="search"
              class="ss-input"
              placeholder={s.search}
              value={text}
              onInput={(e) => setText(e.currentTarget.value)}
            />
          </label>
          {!inTrash ? (
            <>
              <label class="ss-select">
                <span class="ss-sr">{s.sort}</span>
                <select
                  class="ss-input"
                  value={sort}
                  onChange={(e) => setSort(e.currentTarget.value as SortKey)}
                >
                  <option value="updated">{s.sortUpdated}</option>
                  <option value="created">{s.sortCreated}</option>
                  <option value="title">{s.sortTitle}</option>
                  <option value="steps">{s.sortSteps}</option>
                </select>
              </label>
              <label class="ss-select">
                <span class="ss-sr">{s.filterApp}</span>
                <select
                  class="ss-input"
                  value={app}
                  onChange={(e) => setApp(e.currentTarget.value)}
                >
                  <option value="">{s.anyApp}</option>
                  {apps.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              {tags.length ? (
                <label class="ss-select">
                  <span class="ss-sr">{s.filterTag}</span>
                  <select
                    class="ss-input"
                    value={tag}
                    onChange={(e) => setTag(e.currentTarget.value)}
                  >
                    <option value="">{s.anyTag}</option>
                    {tags.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          ) : null}
          <div class="ss-segmented" role="group" aria-label={s.gridView + ' / ' + s.listView}>
            <button
              type="button"
              aria-pressed={view === 'grid'}
              aria-label={s.gridView}
              onClick={() => setView('grid')}
            >
              <Icon name="grid" />
            </button>
            <button
              type="button"
              aria-pressed={view === 'list'}
              aria-label={s.listView}
              onClick={() => setView('list')}
            >
              <Icon name="list" />
            </button>
          </div>
        </div>

        {notice ? (
          <p class="ss-notice" role="status">
            {notice}{' '}
            <button type="button" class="ss-link" onClick={() => setNotice('')}>
              {s.close}
            </button>
          </p>
        ) : null}

        {loaded && !inTrash && !guides.some((g) => !g.trashedAt) ? (
          <EmptyState title={s.firstGuide} text={s.firstGuideText}>
            <div class="ss-row">
              {onStartCapture ? (
                <Button variant="primary" size="lg" onClick={onStartCapture}>
                  <Icon name="capture" size={20} /> {strings.sidePanel.start}
                </Button>
              ) : null}
              {onAddSamples ? (
                <Button size="lg" onClick={() => void act(onAddSamples)}>
                  {s.addSamples}
                </Button>
              ) : null}
            </div>
          </EmptyState>
        ) : loaded && shown.length === 0 ? (
          <p class="ss-empty">{inTrash ? s.emptyTrash : text ? s.emptySearch : s.empty}</p>
        ) : null}

        <ul class={view === 'grid' ? 'ss-cards' : 'ss-rows'} aria-label={s.title}>
          {shown.map((g) => (
            <GuideCard
              key={g.id}
              store={store}
              guide={g}
              view={view}
              trash={inTrash}
              onOpen={() => onOpen(g.id)}
              {...(onSchedule ? { schedulable: g.apps.some((a) => a.kind === 'web') } : {})}
              {...(onGuideMe && onRunForMe
                ? { runnable: g.apps.some((a) => a.kind === 'web') }
                : {})}
              onAction={(action) => {
                switch (action) {
                  case 'guide-me':
                    onGuideMe?.(g.id);
                    break;
                  case 'run-for-me':
                    onRunForMe?.(g.id);
                    break;
                  case 'schedule':
                    onSchedule?.(g.id);
                    break;
                  case 'rename':
                  case 'tags':
                  case 'move':
                  case 'purge':
                    setModal({ kind: action, guide: g });
                    break;
                  case 'duplicate':
                    void act(() => duplicateGuide(store, g.id, s.copyOf(g.title)));
                    break;
                  case 'export':
                    void exportGuide(g);
                    break;
                  case 'backup':
                    setModal({ kind: 'backup', guide: g });
                    break;
                  case 'trash':
                    void act(() => store.trashGuide(g.id));
                    break;
                  case 'restore':
                    void act(() => store.restoreGuide(g.id));
                    break;
                }
              }}
            />
          ))}
        </ul>
      </main>

      {modal?.kind === 'rename' ? (
        <PromptDialog
          title={s.rename}
          label={s.guideTitle}
          initial={modal.guide.title}
          onClose={() => setModal(null)}
          onSubmit={(title) => void updateGuide(modal.guide.id, (g) => (g.title = title))}
        />
      ) : null}
      {modal?.kind === 'tags' ? (
        <PromptDialog
          title={s.tags}
          label={s.tags}
          hint={s.tagsHint}
          initial={modal.guide.tags.join(', ')}
          onClose={() => setModal(null)}
          onSubmit={(value) => void updateGuide(modal.guide.id, (g) => (g.tags = parseTags(value)))}
        />
      ) : null}
      {modal?.kind === 'move' ? (
        <MoveDialog
          folders={tree}
          current={modal.guide.folderId}
          onClose={() => setModal(null)}
          onMove={(folderId) =>
            void updateGuide(modal.guide.id, (g) => {
              if (folderId) g.folderId = folderId;
              else delete g.folderId;
            })
          }
        />
      ) : null}
      {modal?.kind === 'purge' ? (
        <ConfirmDialog
          title={s.deleteForever}
          message={s.deleteForeverConfirm(modal.guide.title)}
          confirm={s.deleteForever}
          onClose={() => setModal(null)}
          onConfirm={() => void act(() => store.purgeGuide(modal.guide.id))}
        />
      ) : null}
      {modal?.kind === 'backup' ? (
        <ConfirmDialog
          title={s.backup}
          message={s.backupConfirm}
          confirm={s.backupDo}
          onClose={() => setModal(null)}
          onConfirm={() => {
            const g = modal.guide;
            setModal(null);
            void exportGuide(g, 'backup');
          }}
        />
      ) : null}
      {modal?.kind === 'new-folder' ? (
        <PromptDialog
          title={s.newFolder}
          label={s.folderName}
          onClose={() => setModal(null)}
          onSubmit={(name) =>
            void act(() =>
              store.saveFolder({
                id: createId(),
                name,
                ...(modal.parentId ? { parentId: modal.parentId } : {}),
              }),
            )
          }
        />
      ) : null}
      {modal?.kind === 'rename-folder' ? (
        <PromptDialog
          title={s.renameFolder}
          label={s.folderName}
          initial={modal.folder.name}
          onClose={() => setModal(null)}
          onSubmit={(name) => void act(() => store.saveFolder({ ...modal.folder, name }))}
        />
      ) : null}
      {modal?.kind === 'delete-folder' ? (
        <ConfirmDialog
          title={s.deleteFolder}
          message={s.deleteFolderConfirm(modal.folder.name)}
          confirm={s.delete}
          onClose={() => setModal(null)}
          onConfirm={() =>
            void act(async () => {
              await store.deleteFolder(modal.folder.id);
              setScope(
                modal.folder.parentId
                  ? { kind: 'folder', folderId: modal.folder.parentId }
                  : { kind: 'all' },
              );
            })
          }
        />
      ) : null}
    </div>
  );
}

type CardAction =
  | 'guide-me'
  | 'run-for-me'
  | 'rename'
  | 'tags'
  | 'move'
  | 'duplicate'
  | 'export'
  | 'backup'
  | 'schedule'
  | 'trash'
  | 'restore'
  | 'purge';

/** Actions that need a browser step: unavailable (with the reason) for desktop-only guides. */
const WEB_ONLY: Partial<Record<CardAction, 'runnable' | 'schedulable'>> = {
  'guide-me': 'runnable',
  'run-for-me': 'runnable',
  schedule: 'schedulable',
};

function GuideCard(props: {
  store: GuideStore;
  guide: GuideSummary;
  view: 'grid' | 'list';
  trash: boolean;
  /** Offer Schedule; false shows it disabled (no browser steps). */
  schedulable?: boolean;
  /** Offer Guide Me and Run for me; false shows them disabled (no browser steps). */
  runnable?: boolean;
  onOpen: () => void;
  onAction: (a: CardAction) => void;
}) {
  const { guide: g, trash } = props;
  const cover = useImageUrl(props.store, g.id, props.view === 'grid' ? g.cover : undefined);
  const when = trash
    ? s.trashedOn(relativeTime(g.trashedAt ?? g.updatedAt))
    : g.updatedBy
      ? s.editedBy(g.updatedBy, relativeTime(g.updatedAt))
      : s.edited(relativeTime(g.updatedAt));
  const items: [CardAction, string][] = trash
    ? [
        ['restore', s.restore],
        ['purge', s.deleteForever],
      ]
    : [
        ...(props.runnable === undefined
          ? []
          : ([
              ['guide-me', strings.guidance.guideMe],
              ['run-for-me', strings.guidance.runForMe],
            ] as [CardAction, string][])),
        ['rename', s.rename],
        ['tags', s.tags],
        ['move', s.moveTo],
        ['duplicate', s.duplicate],
        ['export', s.export],
        ['backup', s.backup],
        ...(props.schedulable === undefined
          ? []
          : ([['schedule', strings.schedules.schedule]] as [CardAction, string][])),
        ['trash', s.moveToTrash],
      ];
  return (
    <li class="ss-card" data-guide-id={g.id}>
      {props.view === 'grid' ? (
        <div class="ss-card__cover" aria-hidden="true">
          {cover ? (
            <img src={cover} alt="" />
          ) : (
            <span class="ss-card__mark" dangerouslySetInnerHTML={{ __html: MARK_SVG }} />
          )}
        </div>
      ) : null}
      <div class="ss-card__body">
        {trash ? (
          <span class="ss-card__title">{g.title}</span>
        ) : (
          <button type="button" class="ss-card__title ss-link" onClick={props.onOpen}>
            {g.title}
          </button>
        )}
        <span class="ss-card__meta">
          <span>{s.steps(g.stepCount)}</span>
          {g.apps[0] ? <Chip label={appLabel(g.apps[0])} /> : null}
          <span>{when}</span>
        </span>
        {g.tags.length ? (
          <span class="ss-tags">
            {g.tags.map((t) => (
              <span key={t} class="ss-tag">
                {t}
              </span>
            ))}
          </span>
        ) : null}
        {props.runnable !== undefined && !trash ? (
          <span class="ss-card__run">
            <Button
              size="sm"
              variant="primary"
              disabled={!props.runnable}
              aria-label={strings.guidance.guideMeFor(g.title)}
              title={props.runnable ? strings.guidance.guideMeHint : strings.guidance.noWebSteps}
              onClick={() => props.onAction('guide-me')}
            >
              <Icon name="trail" size={16} /> {strings.guidance.guideMe}
            </Button>
            <Button
              size="sm"
              disabled={!props.runnable}
              aria-label={strings.guidance.runForMeFor(g.title)}
              title={props.runnable ? strings.guidance.runForMeHint : strings.guidance.noWebSteps}
              onClick={() => props.onAction('run-for-me')}
            >
              <Icon name="play" size={16} /> {strings.guidance.runForMe}
            </Button>
          </span>
        ) : null}
      </div>
      <details class="ss-menu">
        <summary aria-label={`${s.actions}: ${g.title}`}>
          <Icon name="more" />
        </summary>
        <ul role="menu">
          {items.map(([action, label]) => {
            const needs = WEB_ONLY[action];
            const off = !!needs && !props[needs];
            return (
              <li key={action} role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={off}
                  {...(off
                    ? {
                        title:
                          action === 'schedule'
                            ? strings.schedules.needsWebStep
                            : strings.guidance.noWebSteps,
                      }
                    : {})}
                  onClick={(e) => {
                    (
                      e.currentTarget.closest('details') as HTMLDetailsElement | null
                    )?.removeAttribute('open');
                    props.onAction(action);
                  }}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </details>
    </li>
  );
}

function MoveDialog(props: {
  folders: ReturnType<typeof folderTree>;
  current: string | undefined;
  onClose: () => void;
  onMove: (folderId: string | undefined) => void;
}) {
  const [value, setValue] = useState(props.current ?? '');
  return (
    <Dialog
      title={s.moveTo}
      onClose={props.onClose}
      actions={
        <>
          <Button onClick={props.onClose}>{s.cancel}</Button>
          <Button variant="primary" onClick={() => props.onMove(value || undefined)}>
            {s.save}
          </Button>
        </>
      }
    >
      <div class="ss-field">
        <label for="ss-move-to">{s.folders}</label>
        <select
          id="ss-move-to"
          class="ss-input"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
        >
          <option value="">{s.moveToRoot}</option>
          {props.folders.map(({ folder, depth }) => (
            <option key={folder.id} value={folder.id}>
              {'  '.repeat(depth)}
              {folder.name}
            </option>
          ))}
        </select>
      </div>
    </Dialog>
  );
}
