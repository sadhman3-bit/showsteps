import {
  History,
  applyBlurToSteps,
  deleteBlocks,
  duplicateBlocks,
  insertBlankStep,
  insertCallout,
  insertHeading,
  mergeWithNext,
  moveBlocks,
  nudgeBlock,
  plain,
  splitStep,
  stepNumbers,
  thumbNameFor,
  toPlainText,
  updateBlock,
  updateStep,
  type Block,
  type CalloutTone,
  type Guide,
  type GuideStore,
  type Rect,
  type Step,
} from '@trailmark/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Icon } from '../components/Icon.js';
import { GuideReader } from '../guide/GuideReader.js';
import { Screenshot } from '../guide/Screenshot.js';
import { usePreference } from '../hooks.js';
import { strings } from '../strings.js';
import { BrandingDialog, ShortcutsDialog, VersionsDialog } from './EditorDialogs.js';
import { ImageEditor } from './ImageEditor.js';
import { clipboardImage, encodeImage } from './imageio.js';
import { RichTextField } from './RichTextField.js';
import { TextField } from './TextField.js';

const e = strings.editor;
const AUTOSAVE_MS = 600;
/** Keep a version at most this often while editing (plus on leaving the editor). */
const VERSION_EVERY_MS = 2 * 60_000;

export interface GuideEditorProps {
  store: GuideStore;
  guideId: string;
  onBack: () => void;
  onCaptureMore?: (guide: Guide, insertAt: number) => void;
  onRecapture?: (guide: Guide, stepId: string) => void;
  stepLink?: (guideId: string, stepId: string) => string;
  /** Bumped when the guide may have changed elsewhere (e.g. re-captured); reloads if idle. */
  refreshKey?: number;
}

type SaveState = 'saved' | 'saving' | 'failed';
type Modal = 'versions' | 'branding' | 'shortcuts' | null;

/** Same guide content, ignoring save bookkeeping (updatedAt, updatedBy). */
function sameContent(a: Guide, b: Guide): boolean {
  const strip = ({ updatedAt: _a, updatedBy: _b, ...rest }: Guide) => JSON.stringify(rest);
  return strip(a) === strip(b);
}

const isEditable = (t: EventTarget | null) =>
  t instanceof Element &&
  !!t.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');

const blockLabel = (b: Block, numbers: Map<string, number>) =>
  b.kind === 'step'
    ? strings.guide.stepLabel(numbers.get(b.id) ?? 0)
    : b.kind === 'heading'
      ? `${e.headingText}: ${b.text}`
      : strings.guide.tone[b.tone];

/** The guide editor: blocks, rich text, images, keyboard, autosave, versions and branding. */
export function GuideEditor({
  store,
  guideId,
  onBack,
  onCaptureMore,
  onRecapture,
  stepLink,
  refreshKey,
}: GuideEditorProps) {
  const history = useRef<History<Guide> | null>(null);
  const [guide, setGuide] = useState<Guide | null | undefined>(undefined);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [compact, setCompact] = usePreference<'on' | 'off'>('editor.compact', 'off');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [imageFor, setImageFor] = useState<string>();
  const [modal, setModal] = useState<Modal>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [copied, setCopied] = useState<string>();
  const dragIds = useRef<string[]>([]);
  // The drop target is read in the drop handler, which can run before a re-render.
  const dropRef = useRef<{ id: string; after: boolean } | null>(null);
  const typing = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSaved = useRef<Guide | null>(null);
  const lastVersionAt = useRef(0);
  const dirtySinceVersion = useRef(false);
  const imageInput = useRef<HTMLInputElement>(null);
  /** Where the next image step goes: a block id, null for the start, undefined for the end. */
  const imageInsertAfter = useRef<string | null | undefined>(undefined);

  // Keyboard and paste are handled on the document so they work wherever focus is (even on the
  // page body after clicking empty space). The latest handlers are read through a ref.
  const handlers = useRef<{
    key?: (ev: KeyboardEvent) => void;
    paste?: (ev: ClipboardEvent) => void;
  }>({});
  useEffect(() => {
    const key = (ev: KeyboardEvent) => handlers.current.key?.(ev);
    const paste = (ev: ClipboardEvent) => handlers.current.paste?.(ev);
    document.addEventListener('keydown', key);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('paste', paste);
    };
  }, []);

  // ---------- Loading and saving ----------

  const load = useCallback(async () => {
    const g = (await store.getGuide(guideId)) ?? null;
    if (g) {
      const h = history.current;
      // A refresh only matters when the stored content differs from what is on screen.
      if (h && sameContent(g, h.current)) return;
      if (!h) history.current = new History(g);
      else h.push(g);
      lastSaved.current = g;
    }
    setGuide(g);
  }, [store, guideId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reload after external changes (re-capture, capture more), but never over unsaved edits.
  useEffect(() => {
    if (refreshKey === undefined || !history.current || pending.current) return;
    void load();
  }, [refreshKey]);

  const save = useCallback(
    async (g: Guide, forceVersion = false) => {
      const now = Date.now();
      const snapshot = forceVersion || now - lastVersionAt.current > VERSION_EVERY_MS;
      setSaveState('saving');
      try {
        await store.saveGuide(g, { snapshot });
        lastSaved.current = g;
        if (snapshot) {
          lastVersionAt.current = now;
          dirtySinceVersion.current = false;
        } else {
          dirtySinceVersion.current = true;
        }
        setSaveState('saved');
      } catch {
        setSaveState('failed');
      }
    },
    [store],
  );

  const schedule = (g: Guide) => {
    clearTimeout(pending.current);
    setSaveState('saving');
    pending.current = setTimeout(() => {
      pending.current = undefined;
      void save(g);
    }, AUTOSAVE_MS);
  };

  // Leaving the editor: write anything pending and keep a version of the session.
  useEffect(
    () => () => {
      const g = history.current?.current;
      if (!g) return;
      if (pending.current) {
        clearTimeout(pending.current);
        void save(g, true);
      } else if (dirtySinceVersion.current) {
        void save(g, true);
      }
    },
    [save],
  );

  /** Apply an edit. `mode` "push" makes an undo point; "type" groups a run of typing into one. */
  const apply = (edit: Guide | ((latest: Guide) => Guide), how: 'push' | 'type' = 'push') => {
    const h = history.current;
    if (!h) return;
    // Functional edits apply to the latest guide, not the one this render saw.
    const next = typeof edit === 'function' ? edit(h.current) : edit;
    if (next === h.current) return;
    if (how === 'type' && typing.current) h.replace(next);
    else h.push(next);
    typing.current = how === 'type';
    setGuide(h.current);
    schedule(h.current);
  };
  const endTyping = () => {
    typing.current = false;
  };
  const undo = () => {
    const h = history.current;
    if (!h?.canUndo) return;
    endTyping();
    setGuide(h.undo());
    schedule(h.current);
  };
  const redo = () => {
    const h = history.current;
    if (!h?.canRedo) return;
    endTyping();
    setGuide(h.redo());
    schedule(h.current);
  };

  const numbers = useMemo(() => (guide ? stepNumbers(guide) : new Map<string, number>()), [guide]);

  if (guide === undefined) return <main class="tm-page" aria-busy="true" />;
  if (guide === null) {
    return (
      <main class="tm-page">
        <Button variant="ghost" onClick={onBack}>
          <Icon name="back" /> {strings.guide.back}
        </Button>
        <p class="tm-empty">{strings.guide.notFound}</p>
      </main>
    );
  }

  // ---------- Block actions ----------

  const targetIds = (id?: string) =>
    (id && !selected.has(id) ? [id] : [...selected]).filter(Boolean);
  const ordered = (ids: string[]) =>
    guide.blocks.filter((b) => ids.includes(b.id)).map((b) => b.id);

  const removeBlocks = (ids: string[]) => {
    if (!ids.length) return;
    apply(deleteBlocks(guide, ids));
    setSelected(new Set());
  };
  const duplicate = (ids: string[]) => {
    if (!ids.length) return;
    const r = duplicateBlocks(guide, ordered(ids));
    apply(r.guide);
  };
  const addStep = (afterId: string | null) => {
    const r = insertBlankStep(guide, afterId);
    apply(r.guide);
    focusBlock(r.id);
  };
  const addHeading = (afterId: string | null) => {
    const r = insertHeading(guide, afterId, e.newHeading);
    apply(r.guide);
    focusBlock(r.id);
  };
  const addCallout = (afterId: string | null, tone: CalloutTone = 'note') => {
    const r = insertCallout(guide, afterId, tone, e.newCallout);
    apply(r.guide);
    focusBlock(r.id);
  };
  const addImageStep = async (blob: Blob, afterId: string | null) => {
    const img = await encodeImage(blob);
    const r = insertBlankStep(guide, afterId);
    const name = `${r.id}.${img.ext}`;
    await store.putImage(guide.id, name, img.full);
    await store.putImage(guide.id, thumbNameFor(name), img.thumb);
    apply(
      updateStep(r.guide, r.id, (s) => ({
        ...s,
        capture: { ...s.capture, source: 'upload' },
        human: {
          ...s.human,
          screenshot: { file: `img/${name}`, width: img.width, height: img.height, dpr: 1 },
        },
      })),
    );
    focusBlock(r.id);
  };
  const pickImageStep = (afterId: string | null) => {
    imageInsertAfter.current = afterId;
    imageInput.current?.click();
  };

  const focusBlock = (id: string) => {
    setFocused(id);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`);
      (el?.querySelector<HTMLElement>('[contenteditable], input, textarea') ?? el)?.focus();
    });
  };

  const onImageSave = (step: Step, bulk?: { rects: Rect[]; stepIds: string[] }) => {
    let next = updateStep(guide, step.id, () => step);
    if (bulk) for (const r of bulk.rects) next = applyBlurToSteps(next, r, bulk.stepIds);
    apply(next);
    setImageFor(undefined);
  };

  // ---------- Keyboard and paste ----------

  const onKeyDown = (ev: KeyboardEvent) => {
    if (imageFor || modal) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();
    const current = focused;
    if (mod && ev.key === 'Enter') {
      ev.preventDefault();
      addStep(current ?? guide.blocks.at(-1)?.id ?? null);
      return;
    }
    if (isEditable(ev.target)) return; // fields keep their own undo, delete and shortcuts
    if (mod && key === 'z' && !ev.shiftKey) {
      ev.preventDefault();
      undo();
    } else if (mod && (key === 'y' || (key === 'z' && ev.shiftKey))) {
      ev.preventDefault();
      redo();
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      const ids = targetIds(current);
      if (ids.length) {
        ev.preventDefault();
        removeBlocks(ids);
      }
    } else if (mod && key === 'd') {
      ev.preventDefault();
      duplicate(targetIds(current));
    } else if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && current) {
      ev.preventDefault();
      apply(nudgeBlock(guide, current, ev.key === 'ArrowUp' ? -1 : 1));
      focusBlock(current);
    } else if (ev.key === '?') {
      ev.preventDefault();
      setModal('shortcuts');
    }
  };

  const onPaste = (ev: ClipboardEvent) => {
    if (imageFor || modal || mode !== 'edit') return;
    void clipboardImage(ev).then((blob) => {
      if (blob) void addImageStep(blob, focused ?? guide.blocks.at(-1)?.id ?? null);
    });
  };

  // ---------- Drag and drop ----------

  const onDragStart = (id: string, ev: DragEvent) => {
    dragIds.current = selected.has(id) ? ordered([...selected]) : [id];
    ev.dataTransfer?.setData('text/plain', id);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (id: string, ev: DragEvent) => {
    if (!dragIds.current.length) return;
    ev.preventDefault();
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const next = { id, after: ev.clientY > rect.top + rect.height / 2 };
    dropRef.current = next;
    setDrop(next);
  };
  const onDrop = (ev: DragEvent) => {
    ev.preventDefault();
    const ids = dragIds.current;
    dragIds.current = [];
    const target = dropRef.current;
    dropRef.current = null;
    setDrop(null);
    if (!ids.length || !target || ids.includes(target.id)) return;
    const rest = guide.blocks.filter((b) => !ids.includes(b.id));
    const at = rest.findIndex((b) => b.id === target.id) + (target.after ? 1 : 0);
    apply(moveBlocks(guide, ids, at));
  };

  handlers.current = { key: onKeyDown, paste: onPaste };

  // ---------- Rendering ----------

  const hidden = new Set<string>();
  let inCollapsed = false;
  for (const b of guide.blocks) {
    if (b.kind === 'heading') inCollapsed = collapsed.has(b.id);
    else if (inCollapsed) hidden.add(b.id);
  }
  const editingStep = imageFor
    ? guide.blocks.find((b): b is Step => b.kind === 'step' && b.id === imageFor)
    : undefined;

  return (
    <main class="tm-editor">
      <header class="tm-editor__bar">
        <Button variant="ghost" onClick={onBack}>
          <Icon name="back" /> {strings.guide.back}
        </Button>
        <span class={`tm-save tm-save--${saveState}`} role="status">
          {saveState === 'saved' ? e.saved : saveState === 'saving' ? e.saving : e.saveFailed}
        </span>
        <div class="tm-toolbar__spacer" />
        <Button
          variant="ghost"
          onClick={undo}
          disabled={!history.current?.canUndo}
          aria-label={e.undo}
          title={e.undo}
        >
          ↶
        </Button>
        <Button
          variant="ghost"
          onClick={redo}
          disabled={!history.current?.canRedo}
          aria-label={e.redo}
          title={e.redo}
        >
          ↷
        </Button>
        <div class="tm-segmented" role="group">
          <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>
            {e.edit}
          </button>
          <button
            type="button"
            aria-pressed={mode === 'preview'}
            onClick={() => setMode('preview')}
          >
            {e.preview}
          </button>
        </div>
        {mode === 'edit' ? (
          <Button
            aria-pressed={compact === 'on'}
            title={e.compactHint}
            onClick={() => setCompact(compact === 'on' ? 'off' : 'on')}
          >
            {e.compact}
          </Button>
        ) : null}
        <Button onClick={() => setModal('versions')}>{e.versions}</Button>
        <Button onClick={() => setModal('branding')}>{e.branding}</Button>
        <Button
          variant="ghost"
          onClick={() => setModal('shortcuts')}
          aria-label={e.shortcuts}
          title={e.shortcuts}
        >
          ?
        </Button>
        {onCaptureMore ? (
          <Button
            onClick={() =>
              onCaptureMore(
                guide,
                focused ? guide.blocks.findIndex((b) => b.id === focused) + 1 : guide.blocks.length,
              )
            }
          >
            <Icon name="record" /> {strings.guide.captureMore}
          </Button>
        ) : null}
      </header>

      {mode === 'preview' ? (
        <div class="tm-page">
          <GuideReader
            store={store}
            guide={guide}
            {...(copied ? { copiedStepId: copied } : {})}
            {...(stepLink
              ? {
                  onCopyLink: (stepId: string) =>
                    void navigator.clipboard
                      .writeText(stepLink(guide.id, stepId))
                      .then(() => setCopied(stepId)),
                }
              : {})}
          />
        </div>
      ) : (
        <div class="tm-page tm-editor__page">
          <TextField
            class="tm-editor__title"
            aria-label={e.guideTitle}
            value={guide.title}
            onValue={(title) => apply((g) => ({ ...g, title }), 'type')}
            onDone={endTyping}
          />
          <TextField
            multiline
            class="tm-editor__desc tm-input"
            aria-label={e.guideDescription}
            placeholder={e.guideDescriptionPlaceholder}
            value={guide.description ?? ''}
            rows={2}
            onValue={(description) =>
              apply((g) => {
                const next = { ...g };
                if (description) next.description = description;
                else delete next.description;
                return next;
              }, 'type')
            }
            onDone={endTyping}
          />

          {selected.size ? (
            <div class="tm-selbar" role="toolbar" aria-label={e.selected(selected.size)}>
              <strong>{e.selected(selected.size)}</strong>
              <Button onClick={() => duplicate([...selected])}>{e.duplicateSelected}</Button>
              <Button variant="danger" onClick={() => removeBlocks([...selected])}>
                {e.deleteSelected}
              </Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                {e.clearSelection}
              </Button>
            </div>
          ) : null}

          <ol
            class={`tm-eblocks${compact === 'on' ? ' tm-eblocks--compact' : ''}`}
            aria-label={guide.title}
            onDrop={onDrop}
            onDragOver={(ev) => ev.preventDefault()}
          >
            {guide.blocks.map((b) =>
              hidden.has(b.id) ? null : (
                <BlockCard
                  key={b.id}
                  store={store}
                  guide={guide}
                  block={b}
                  label={blockLabel(b, numbers)}
                  num={numbers.get(b.id) ?? 0}
                  selected={selected.has(b.id)}
                  dropMark={drop?.id === b.id ? (drop.after ? 'after' : 'before') : undefined}
                  collapsed={collapsed.has(b.id)}
                  isLastStep={
                    !guide.blocks.slice(guide.blocks.indexOf(b) + 1).some((x) => x.kind === 'step')
                  }
                  onFocus={() => setFocused(b.id)}
                  onSelect={(on) => {
                    const next = new Set(selected);
                    if (on) next.add(b.id);
                    else next.delete(b.id);
                    setSelected(next);
                  }}
                  onDragStart={(ev) => onDragStart(b.id, ev)}
                  onDragOver={(ev) => onDragOver(b.id, ev)}
                  onDragEnd={() => {
                    dragIds.current = [];
                    dropRef.current = null;
                    setDrop(null);
                  }}
                  onChange={(change, how) => apply((g) => updateBlock(g, b.id, change), how)}
                  onEndTyping={endTyping}
                  onToggleCollapse={() => {
                    const next = new Set(collapsed);
                    if (next.has(b.id)) next.delete(b.id);
                    else next.add(b.id);
                    setCollapsed(next);
                  }}
                  onEditImage={() => setImageFor(b.id)}
                  onAddImage={() => pickImageStep(null)}
                  onMenu={(action) => {
                    switch (action) {
                      case 'up':
                      case 'down':
                        apply(nudgeBlock(guide, b.id, action === 'up' ? -1 : 1));
                        break;
                      case 'duplicate':
                        duplicate([b.id]);
                        break;
                      case 'delete':
                        removeBlocks([b.id]);
                        break;
                      case 'step':
                        addStep(b.id);
                        break;
                      case 'image':
                        pickImageStep(b.id);
                        break;
                      case 'heading':
                        addHeading(b.id);
                        break;
                      case 'callout':
                        addCallout(b.id);
                        break;
                      case 'merge':
                        apply(mergeWithNext(guide, b.id));
                        break;
                      case 'split': {
                        const r = splitStep(guide, b.id);
                        apply(r.guide);
                        break;
                      }
                    }
                  }}
                />
              ),
            )}
          </ol>

          <div class="tm-addbar">
            <Button onClick={() => addStep(guide.blocks.at(-1)?.id ?? null)}>
              <Icon name="plus" /> {e.addStep}
            </Button>
            <Button onClick={() => pickImageStep(guide.blocks.at(-1)?.id ?? null)}>
              <Icon name="plus" /> {e.addImageStep}
            </Button>
            <Button onClick={() => addHeading(guide.blocks.at(-1)?.id ?? null)}>
              <Icon name="plus" /> {e.addHeading}
            </Button>
            <Button onClick={() => addCallout(guide.blocks.at(-1)?.id ?? null)}>
              <Icon name="plus" /> {e.addCallout}
            </Button>
          </div>
          <p class="tm-muted">{e.pasteHint}</p>
          <input
            ref={imageInput}
            type="file"
            accept="image/*"
            hidden
            aria-label={e.addImageStep}
            onChange={(ev) => {
              const f = ev.currentTarget.files?.[0];
              ev.currentTarget.value = '';
              const after = imageInsertAfter.current;
              imageInsertAfter.current = undefined;
              if (f)
                void addImageStep(
                  f,
                  after === undefined ? (guide.blocks.at(-1)?.id ?? null) : after,
                );
            }}
          />
        </div>
      )}

      {editingStep ? (
        <ImageEditor
          store={store}
          guide={guide}
          step={editingStep}
          onClose={() => setImageFor(undefined)}
          onSave={onImageSave}
          {...(onRecapture
            ? {
                onRecapture: () => {
                  setImageFor(undefined);
                  onRecapture(guide, editingStep.id);
                },
              }
            : {})}
        />
      ) : null}
      {modal === 'versions' ? (
        <VersionsDialog
          store={store}
          guideId={guide.id}
          onClose={() => setModal(null)}
          onRestore={(version) => {
            setModal(null);
            clearTimeout(pending.current);
            pending.current = undefined;
            const h = history.current;
            if (!h) return;
            // Keep the current guide as a version, then restore.
            void save(h.current, true).then(() => {
              const restored = { ...version, id: guide.id };
              h.push(restored);
              setGuide(h.current);
              void save(restored, true);
            });
          }}
        />
      ) : null}
      {modal === 'branding' ? (
        <BrandingDialog
          store={store}
          guide={guide}
          onClose={() => setModal(null)}
          onChange={(branding) => {
            const next = { ...guide };
            if (branding) next.branding = branding;
            else delete next.branding;
            apply(next);
          }}
        />
      ) : null}
      {modal === 'shortcuts' ? <ShortcutsDialog onClose={() => setModal(null)} /> : null}
    </main>
  );
}

type MenuAction =
  | 'up'
  | 'down'
  | 'duplicate'
  | 'delete'
  | 'step'
  | 'image'
  | 'heading'
  | 'callout'
  | 'merge'
  | 'split';

function BlockCard(props: {
  store: GuideStore;
  guide: Guide;
  block: Block;
  label: string;
  num: number;
  selected: boolean;
  dropMark: 'before' | 'after' | undefined;
  collapsed: boolean;
  isLastStep: boolean;
  onFocus: () => void;
  onSelect: (on: boolean) => void;
  onDragStart: (ev: DragEvent) => void;
  onDragOver: (ev: DragEvent) => void;
  onDragEnd: () => void;
  onChange: (change: (latest: Block) => Block, how: 'push' | 'type') => void;
  onEndTyping: () => void;
  onToggleCollapse: () => void;
  onEditImage: () => void;
  onAddImage: () => void;
  onMenu: (action: MenuAction) => void;
}) {
  const { block: b, label } = props;
  const items: [MenuAction, string][] = [
    ['up', e.moveUp],
    ['down', e.moveDown],
    ['duplicate', e.duplicate],
    ['step', e.addStepBelow],
    ['image', e.addImageStepBelow],
    ['heading', e.addHeadingBelow],
    ['callout', e.addCalloutBelow],
    ...(b.kind === 'step' && !props.isLastStep
      ? ([['merge', e.mergeWithNext]] as [MenuAction, string][])
      : []),
    ...(b.kind === 'step' ? ([['split', e.splitStep]] as [MenuAction, string][]) : []),
    ['delete', e.delete],
  ];
  return (
    <li
      class={`tm-eblock tm-eblock--${b.kind}${props.selected ? ' is-selected' : ''}${props.dropMark ? ` drop-${props.dropMark}` : ''}`}
      data-block-id={b.id}
      tabIndex={0}
      aria-label={label}
      onFocusCapture={props.onFocus}
      onDragOver={props.onDragOver}
    >
      <div class="tm-eblock__rail">
        <input
          type="checkbox"
          aria-label={e.select(label)}
          checked={props.selected}
          onChange={(ev) => props.onSelect(ev.currentTarget.checked)}
        />
        <span
          class="tm-eblock__handle"
          draggable
          role="button"
          aria-label={e.dragHandle(label)}
          title={e.dragHandle(label)}
          onDragStart={props.onDragStart}
          onDragEnd={props.onDragEnd}
        >
          ⋮⋮
        </span>
        {b.kind === 'step' ? <span class="tm-step__num">{props.num}</span> : null}
      </div>

      <div class="tm-eblock__main">
        {b.kind === 'step' ? (
          <StepFields step={b} {...props} />
        ) : b.kind === 'heading' ? (
          <div class="tm-eblock__row">
            <button
              type="button"
              class="tm-link"
              aria-expanded={!props.collapsed}
              aria-label={props.collapsed ? e.expandSection : e.collapseSection}
              onClick={props.onToggleCollapse}
            >
              {props.collapsed ? '▸' : '▾'}
            </button>
            <TextField
              class="tm-eblock__heading tm-input"
              aria-label={e.headingText}
              value={b.text}
              onValue={(text) =>
                props.onChange((x) => (x.kind === 'heading' ? { ...x, text } : x), 'type')
              }
              onDone={props.onEndTyping}
            />
          </div>
        ) : (
          <div class={`tm-callout tm-callout--${b.tone} tm-eblock__callout`}>
            <select
              class="tm-input"
              aria-label={e.calloutTone}
              value={b.tone}
              onChange={(ev) => {
                const tone = ev.currentTarget.value as CalloutTone;
                props.onChange((x) => (x.kind === 'callout' ? { ...x, tone } : x), 'push');
              }}
            >
              {(['tip', 'note', 'warning', 'alert'] as const).map((t) => (
                <option key={t} value={t}>
                  {strings.guide.tone[t]}
                </option>
              ))}
            </select>
            <TextField
              multiline
              class="tm-input"
              aria-label={e.calloutText}
              rows={2}
              value={b.text}
              onValue={(text) =>
                props.onChange((x) => (x.kind === 'callout' ? { ...x, text } : x), 'type')
              }
              onDone={props.onEndTyping}
            />
          </div>
        )}
      </div>

      <details class="tm-menu tm-eblock__menu">
        <summary aria-label={e.blockActions(label)}>
          <Icon name="more" />
        </summary>
        <ul role="menu">
          {items.map(([action, text]) => (
            <li key={action} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={(ev) => {
                  (
                    ev.currentTarget.closest('details') as HTMLDetailsElement | null
                  )?.removeAttribute('open');
                  props.onMenu(action);
                }}
              >
                {text}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function StepFields(props: {
  store: GuideStore;
  guide: Guide;
  step: Step;
  num: number;
  onChange: (change: (latest: Block) => Block, how: 'push' | 'type') => void;
  onEndTyping: () => void;
  onEditImage: () => void;
  onAddImage: () => void;
}) {
  const { step: s, num } = props;
  const [showAlt, setShowAlt] = useState(!!s.human.altText);
  /** Change this step's human fields, applied to the latest version of the step. */
  const editHuman = (change: (h: Step['human']) => Step['human']) =>
    props.onChange((x) => (x.kind === 'step' ? { ...x, human: change(x.human) } : x), 'type');
  return (
    <>
      <RichTextField
        class="tm-eblock__title"
        label={e.stepTitle(num)}
        value={s.human.title}
        onChange={(title) => editHuman((h) => ({ ...h, title }))}
        onCommit={props.onEndTyping}
      />
      <RichTextField
        class="tm-eblock__desc"
        multiline
        label={e.stepDescription(num)}
        placeholder={e.descriptionPlaceholder}
        value={s.human.description ?? plain('')}
        onChange={(description) =>
          editHuman((h) => {
            const next: Step['human'] = { ...h, description };
            if (!toPlainText(description)) delete next.description;
            return next;
          })
        }
        onCommit={props.onEndTyping}
      />
      {s.human.screenshot ? (
        <div class="tm-eblock__shot">
          <button
            type="button"
            class="tm-eblock__shotbtn"
            aria-label={`${e.editImage}: ${strings.guide.stepLabel(num)}`}
            onClick={props.onEditImage}
          >
            <Screenshot
              store={props.store}
              guideId={props.guide.id}
              step={s}
              alt={s.human.altText ?? strings.guide.screenshotAlt(num, toPlainText(s.human.title))}
            />
          </button>
          <div class="tm-toolbar__group">
            <Button onClick={props.onEditImage}>{e.editImage}</Button>
            <Button variant="ghost" aria-expanded={showAlt} onClick={() => setShowAlt(!showAlt)}>
              {e.altText}
            </Button>
          </div>
          {showAlt ? (
            <label class="tm-field">
              <span class="tm-muted">{e.altTextHint}</span>
              <TextField
                class="tm-input"
                aria-label={e.altText}
                value={s.human.altText ?? ''}
                onValue={(altText) =>
                  props.onChange((x) => {
                    if (x.kind !== 'step') return x;
                    const h = { ...x.human };
                    if (altText) h.altText = altText;
                    else delete h.altText;
                    return { ...x, human: h };
                  }, 'type')
                }
                onDone={props.onEndTyping}
              />
            </label>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
