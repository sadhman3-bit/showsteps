import {
  History,
  bulkBlurCandidates,
  clampRect,
  createId,
  resetImage,
  stepNumbers,
  thumbNameFor,
  toPlainText,
  withMagnify,
  withOriginal,
  type Annotation,
  type Guide,
  type GuideStore,
  type Point,
  type Rect,
  type Step,
} from '@showsteps/core';
import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import {
  AnnotationShape,
  annotationBounds,
  moveAnnotation,
  strokeFor,
} from '../components/Annotations.js';
import { ConfirmDialog, Dialog, PromptDialog } from '../components/Dialog.js';
import { ImageLayers } from '../guide/Screenshot.js';
import { useImageUrl } from '../hooks.js';
import { strings } from '../strings.js';
import { clipboardImage, encodeImage } from './imageio.js';

const s = strings.image;

export type Tool = keyof typeof s.tool;
const TOOLS: Tool[] = [
  'select',
  'actionBox',
  'crop',
  'blur',
  'arrow',
  'rect',
  'ellipse',
  'text',
  'pen',
  'badge',
];
const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'actionBox',
  c: 'crop',
  b: 'blur',
  a: 'arrow',
  r: 'rect',
  e: 'ellipse',
  t: 'text',
  p: 'pen',
  n: 'badge',
};
const TOOL_ICONS: Record<Tool, string> = {
  select: '↖',
  actionBox: '▢',
  crop: '⌗',
  blur: '░',
  arrow: '↗',
  rect: '□',
  ellipse: '◯',
  text: 'T',
  pen: '✎',
  badge: '①',
};
export const PALETTE = [
  '#e8590c',
  '#d6336c',
  '#1971c2',
  '#0f6b62',
  '#f2b84b',
  '#111111',
  '#ffffff',
];

type Selection =
  { kind: 'ann'; id: string } | { kind: 'blur'; index: number } | { kind: 'box' } | null;
type Drag =
  | { kind: 'draft'; tool: Tool; from: Point; to: Point; points?: Point[] }
  | { kind: 'move'; target: Selection; from: Point; origin: Step }
  | { kind: 'resize'; corner: 'nw' | 'ne' | 'sw' | 'se'; origin: Rect };

const norm = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x),
  h: Math.abs(b.y - a.y),
});
const round = (r: Rect): Rect => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  w: Math.round(r.w),
  h: Math.round(r.h),
});

export interface ImageEditorProps {
  store: GuideStore;
  guide: Guide;
  step: Step;
  onSave: (step: Step, bulk?: { rects: Rect[]; stepIds: string[] }) => void;
  onClose: () => void;
  /** Platform hook: capture the current screen again for this step. */
  onRecapture?: () => void;
  /** Starting tool (tests and the "blur" shortcut). */
  initialTool?: Tool;
}

export function ImageEditor({
  store,
  guide,
  step,
  onSave,
  onClose,
  onRecapture,
  initialTool = 'select',
}: ImageEditorProps) {
  const history = useRef(new History<Step>(withOriginal(step)));
  const [work, setWork] = useState<Step>(history.current.current);
  const [tool, setTool] = useState<Tool>(initialTool);
  const [color, setColor] = useState<string>(PALETTE[0] ?? '#e8590c');
  const [selected, setSelected] = useState<Selection>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [zoom, setZoom] = useState(
    work.human.screenshot?.zoom && work.human.screenshot.zoom > 1 ? work.human.screenshot.zoom : 2,
  );
  const [modal, setModal] = useState<'text' | 'bulk' | 'reset' | null>(null);
  const [textAt, setTextAt] = useState<Point>({ x: 0, y: 0 });
  const [notice, setNotice] = useState('');
  const created = useRef<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const num = stepNumbers(guide).get(step.id) ?? 0;

  const shot = work.human.screenshot;
  const url = useImageUrl(store, guide.id, shot?.file.replace(/^img\//, ''));
  const W = shot?.width ?? 1;
  const H = shot?.height ?? 1;
  const sw = strokeFor(W);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
    return () => el?.close();
  }, []);

  const commit = (next: Step) => setWork(history.current.push(next));
  const human = (change: Partial<Step['human']>) =>
    commit({ ...work, human: { ...work.human, ...change } });
  const undo = () => {
    setSelected(null);
    setWork(history.current.undo());
  };
  const redo = () => {
    setSelected(null);
    setWork(history.current.redo());
  };

  const deleteSelected = () => {
    if (!selected) return;
    if (selected.kind === 'ann')
      human({ annotations: work.human.annotations.filter((a) => a.id !== selected.id) });
    else if (selected.kind === 'blur')
      human({ blurs: work.human.blurs.filter((_, i) => i !== selected.index) });
    else {
      const h = { ...work.human };
      delete h.actionBox;
      commit({ ...work, human: h });
    }
    setSelected(null);
  };

  const recolor = (c: string) => {
    setColor(c);
    if (selected?.kind === 'ann') {
      human({
        annotations: work.human.annotations.map((a) =>
          a.id === selected.id ? { ...a, color: c } : a,
        ),
      });
    }
  };

  /** Client coordinates → image pixels. */
  const toImage = (e: { clientX: number; clientY: number }): Point => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.min(Math.max(p.x, 0), W), y: Math.min(Math.max(p.y, 0), H) };
  };

  const nextBadge = () =>
    Math.max(
      0,
      ...work.human.annotations
        .filter((a) => a.kind === 'badge')
        .map((a) => (a.kind === 'badge' ? a.number : 0)),
    ) + 1;

  const onPointerDown = (e: PointerEvent) => {
    if (!shot || e.button !== 0) return;
    const p = toImage(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const target = e.target as Element;
    if (tool === 'select') {
      const corner = target.getAttribute('data-handle') as 'nw' | 'ne' | 'sw' | 'se' | null;
      if (corner && work.human.actionBox) {
        setDrag({ kind: 'resize', corner, origin: work.human.actionBox });
        return;
      }
      const annId = target.closest('[data-annotation]')?.getAttribute('data-annotation');
      const blurIdx = target.closest('[data-blur-rect]')?.getAttribute('data-blur-rect');
      const sel: Selection = annId
        ? { kind: 'ann', id: annId }
        : blurIdx !== null && blurIdx !== undefined
          ? { kind: 'blur', index: Number(blurIdx) }
          : target.closest('[data-box]')
            ? { kind: 'box' }
            : null;
      setSelected(sel);
      if (sel) setDrag({ kind: 'move', target: sel, from: p, origin: work });
      return;
    }
    if (tool === 'text') {
      setTextAt(p);
      setModal('text');
      return;
    }
    if (tool === 'badge') {
      human({
        annotations: [
          ...work.human.annotations,
          { id: createId(), kind: 'badge', at: p, number: nextBadge(), color },
        ],
      });
      return;
    }
    setDrag({ kind: 'draft', tool, from: p, to: p, ...(tool === 'pen' ? { points: [p] } : {}) });
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return;
    const p = toImage(e);
    if (drag.kind === 'draft') {
      setDrag({ ...drag, to: p, ...(drag.points ? { points: [...drag.points, p] } : {}) });
    } else if (drag.kind === 'move') {
      const dx = p.x - drag.from.x;
      const dy = p.y - drag.from.y;
      const o = drag.origin.human;
      const t = drag.target;
      if (t?.kind === 'ann') {
        setWork({
          ...work,
          human: {
            ...o,
            annotations: o.annotations.map((a) => (a.id === t.id ? moveAnnotation(a, dx, dy) : a)),
          },
        });
      } else if (t?.kind === 'blur') {
        setWork({
          ...work,
          human: {
            ...o,
            blurs: o.blurs.map((r, i) =>
              i === t.index ? clampRect({ ...r, x: r.x + dx, y: r.y + dy }, W, H) : r,
            ),
          },
        });
      } else if (t?.kind === 'box' && o.actionBox) {
        setWork({
          ...work,
          human: {
            ...o,
            actionBox: round({ ...o.actionBox, x: o.actionBox.x + dx, y: o.actionBox.y + dy }),
          },
        });
      }
    } else {
      const r = drag.origin;
      const left = drag.corner.includes('w') ? p.x : r.x;
      const right = drag.corner.includes('e') ? p.x : r.x + r.w;
      const top = drag.corner.includes('n') ? p.y : r.y;
      const bottom = drag.corner.includes('s') ? p.y : r.y + r.h;
      setWork({
        ...work,
        human: {
          ...work.human,
          actionBox: round(norm({ x: left, y: top }, { x: right, y: bottom })),
        },
      });
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    setDrag(null);
    if (drag.kind !== 'draft') {
      // Moves and resizes were previewed with setWork; record one undo point for the gesture.
      setWork(history.current.push(work));
      return;
    }
    const r = round(norm(drag.from, drag.to));
    const big = r.w >= 4 && r.h >= 4;
    switch (drag.tool) {
      case 'crop':
        if (big && shot && r.w < W * 0.98) {
          const zoomed = { ...shot, crop: r, zoom: Math.round((W / r.w) * 100) / 100 };
          commit({ ...work, human: { ...work.human, screenshot: zoomed } });
        }
        break;
      case 'actionBox':
        if (big) human({ actionBox: r });
        break;
      case 'blur':
        if (big) human({ blurs: [...work.human.blurs, r] });
        break;
      case 'rect':
      case 'ellipse':
        if (big)
          human({
            annotations: [
              ...work.human.annotations,
              { id: createId(), kind: drag.tool, rect: r, color },
            ],
          });
        break;
      case 'arrow':
        if (Math.hypot(drag.to.x - drag.from.x, drag.to.y - drag.from.y) > 8) {
          human({
            annotations: [
              ...work.human.annotations,
              { id: createId(), kind: 'arrow', from: drag.from, to: drag.to, color },
            ],
          });
        }
        break;
      case 'pen':
        if ((drag.points?.length ?? 0) > 2) {
          human({
            annotations: [
              ...work.human.annotations,
              { id: createId(), kind: 'pen', points: drag.points ?? [], color },
            ],
          });
        }
        break;
      default:
        break;
    }
  };

  const replaceWith = async (blob: Blob | undefined) => {
    if (!blob) {
      setNotice(s.pasteEmpty);
      return;
    }
    try {
      const img = await encodeImage(blob);
      const name = `${step.id}-${Date.now().toString(36)}.${img.ext}`;
      await store.putImage(guide.id, name, img.full);
      await store.putImage(guide.id, thumbNameFor(name), img.thumb);
      created.current.push(name, thumbNameFor(name));
      const h: Step['human'] = {
        ...work.human,
        screenshot: { file: `img/${name}`, width: img.width, height: img.height, dpr: 1 },
        blurs: [],
        annotations: [],
      };
      delete h.actionBox;
      commit({ ...work, human: h });
      setNotice('');
    } catch {
      setNotice(s.badImage);
    }
  };

  const cancel = () => {
    for (const name of created.current) void store.deleteImage(guide.id, name);
    onClose();
  };

  const save = (bulk?: { rects: Rect[]; stepIds: string[] }) => {
    if (JSON.stringify(work) === JSON.stringify(withOriginal(step)) && !bulk) onClose();
    else onSave(work, bulk);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as Element;
    if (t.closest('input, select, textarea, [contenteditable]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (
      mod &&
      (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))
    ) {
      e.preventDefault();
      redo();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelected();
    } else if (!mod && !e.altKey && TOOL_KEYS[e.key.toLowerCase()]) {
      setTool(TOOL_KEYS[e.key.toLowerCase()] ?? 'select');
    }
  };

  const draft = drag?.kind === 'draft' ? drag : null;
  const box = work.human.actionBox;
  const crop = shot?.crop && (shot.zoom ?? 1) > 1 ? shot.crop : null;
  const magnifyOn = !!crop;
  const candidates = useMemo(() => bulkBlurCandidates(guide, step.id), [guide, step.id]);

  return (
    <dialog
      ref={dialog}
      class="ss-imgedit"
      aria-labelledby={`${uid}-title`}
      onCancel={(e) => {
        e.preventDefault();
        if (!modal) cancel();
      }}
      onKeyDown={onKeyDown}
      onPaste={(e) => void clipboardImage(e).then((b) => b && replaceWith(b))}
    >
      <header class="ss-imgedit__bar">
        <h2 id={`${uid}-title`}>{s.title(num)}</h2>
        <div class="ss-toolbar__spacer" />
        <Button
          variant="ghost"
          onClick={undo}
          disabled={!history.current.canUndo}
          aria-label={strings.editor.undo}
        >
          ↶
        </Button>
        <Button
          variant="ghost"
          onClick={redo}
          disabled={!history.current.canRedo}
          aria-label={strings.editor.redo}
        >
          ↷
        </Button>
        <Button onClick={cancel}>{s.cancel}</Button>
        <Button variant="primary" onClick={() => save()}>
          {s.save}
        </Button>
      </header>

      <div class="ss-imgedit__body">
        <div
          class="ss-imgedit__tools"
          role="toolbar"
          aria-label={s.tools}
          aria-orientation="vertical"
        >
          {TOOLS.map((t) => (
            <button
              key={t}
              type="button"
              class="ss-tool"
              aria-pressed={tool === t}
              aria-label={s.tool[t]}
              title={`${s.tool[t]} (${Object.keys(TOOL_KEYS)
                .find((k) => TOOL_KEYS[k] === t)
                ?.toUpperCase()})`}
              onClick={() => setTool(t)}
            >
              {TOOL_ICONS[t]}
            </button>
          ))}
        </div>

        <div class="ss-imgedit__canvas">
          {shot && url ? (
            <svg
              ref={svg}
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={s.canvasLabel}
              data-tool={tool}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              <ImageLayers
                url={url}
                step={{ ...work, human: { ...work.human, annotations: [] } }}
                showActionBox={false}
                idPrefix={`e${uid}`}
              />
              {work.human.blurs.map((r, i) => (
                <rect
                  key={i}
                  data-blur-rect={i}
                  class={`ss-imgedit__blur${selected?.kind === 'blur' && selected.index === i ? ' is-selected' : ''}`}
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  stroke-width={sw / 1.5}
                />
              ))}
              {work.human.annotations.map((a) => (
                <AnnotationShape
                  key={a.id}
                  a={a}
                  imageWidth={W}
                  selected={selected?.kind === 'ann' && selected.id === a.id}
                />
              ))}
              {selected?.kind === 'ann'
                ? (() => {
                    const a = work.human.annotations.find((x) => x.id === selected.id);
                    if (!a) return null;
                    const b = annotationBounds(a, W);
                    return (
                      <rect
                        class="ss-imgedit__sel"
                        x={b.x - sw}
                        y={b.y - sw}
                        width={b.w + sw * 2}
                        height={b.h + sw * 2}
                        stroke-width={sw / 2}
                      />
                    );
                  })()
                : null}
              {box ? (
                <g
                  data-box="1"
                  class={`ss-imgedit__box${selected?.kind === 'box' ? ' is-selected' : ''}`}
                >
                  <rect
                    class="ss-shot__box"
                    x={box.x}
                    y={box.y}
                    width={box.w}
                    height={box.h}
                    rx={sw * 2}
                    fill="transparent"
                    stroke-width={sw}
                  />
                  {tool === 'select'
                    ? (['nw', 'ne', 'sw', 'se'] as const).map((c) => (
                        <rect
                          key={c}
                          data-handle={c}
                          class="ss-imgedit__handle"
                          x={(c.includes('w') ? box.x : box.x + box.w) - sw * 2}
                          y={(c.includes('n') ? box.y : box.y + box.h) - sw * 2}
                          width={sw * 4}
                          height={sw * 4}
                        />
                      ))
                    : null}
                </g>
              ) : null}
              {crop ? (
                <path
                  class="ss-imgedit__crop"
                  fill-rule="evenodd"
                  d={`M0 0H${W}V${H}H0Z M${crop.x} ${crop.y}h${crop.w}v${crop.h}h${-crop.w}Z`}
                />
              ) : null}
              {draft ? <DraftShape draft={draft} color={color} sw={sw} imageWidth={W} /> : null}
            </svg>
          ) : (
            <p class="ss-empty">{s.noImage}</p>
          )}
        </div>

        <aside class="ss-imgedit__panel">
          <fieldset class="ss-swatches">
            <legend>{s.colour}</legend>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                class="ss-swatch"
                style={{ background: c }}
                aria-label={c}
                aria-pressed={color === c}
                onClick={() => recolor(c)}
              />
            ))}
            <label class="ss-swatch ss-swatch--custom" title={s.customColour}>
              <span class="ss-sr">{s.customColour}</span>
              <input type="color" value={color} onInput={(e) => recolor(e.currentTarget.value)} />
            </label>
          </fieldset>

          <label class="ss-check">
            <input
              type="checkbox"
              checked={magnifyOn}
              disabled={!shot}
              onChange={(e) => commit(withMagnify(work, e.currentTarget.checked ? zoom : 1))}
            />
            {s.magnify}
          </label>
          {magnifyOn ? (
            <label class="ss-field">
              <span>
                {s.zoom}: {zoom}×
              </span>
              <input
                type="range"
                min="1.25"
                max="4"
                step="0.25"
                value={zoom}
                onChange={(e) => {
                  const z = Number(e.currentTarget.value);
                  setZoom(z);
                  commit(withMagnify(work, z));
                }}
              />
            </label>
          ) : null}

          <div class="ss-stack">
            <Button onClick={deleteSelected} disabled={!selected}>
              {s.deleteSelected}
            </Button>
            <Button onClick={() => setModal('bulk')} disabled={!work.human.blurs.length}>
              {s.bulkBlur}
            </Button>
            <Button onClick={() => fileInput.current?.click()}>{s.replace}</Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              aria-label={s.replace}
              onChange={(e) => void replaceWith(e.currentTarget.files?.[0])}
            />
            <Button onClick={() => void clipboardImage().then(replaceWith)}>{s.paste}</Button>
            {onRecapture ? <Button onClick={onRecapture}>{s.recapture}</Button> : null}
            <Button variant="ghost" onClick={() => setModal('reset')}>
              {s.reset}
            </Button>
          </div>
          {notice ? (
            <p class="ss-error" role="alert">
              {notice}
            </p>
          ) : null}
        </aside>
      </div>

      {modal === 'text' ? (
        <PromptDialog
          title={s.tool.text}
          label={s.textPrompt}
          onClose={() => setModal(null)}
          onSubmit={(text) => {
            setModal(null);
            if (text)
              human({
                annotations: [
                  ...work.human.annotations,
                  { id: createId(), kind: 'text', at: textAt, text, color },
                ],
              });
          }}
        />
      ) : null}
      {modal === 'reset' ? (
        <ConfirmDialog
          title={s.reset}
          message={s.resetConfirm}
          confirm={s.reset}
          onClose={() => setModal(null)}
          onConfirm={() => {
            setModal(null);
            setSelected(null);
            commit(resetImage(work));
          }}
        />
      ) : null}
      {modal === 'bulk' ? (
        <BulkBlurDialog
          candidates={candidates}
          numbers={stepNumbers(guide)}
          onClose={() => setModal(null)}
          onApply={(ids) => {
            setModal(null);
            save({ rects: work.human.blurs, stepIds: ids });
          }}
        />
      ) : null}
    </dialog>
  );
}

function DraftShape({
  draft,
  color,
  sw,
  imageWidth,
}: {
  draft: Extract<Drag, { kind: 'draft' }>;
  color: string;
  sw: number;
  imageWidth: number;
}) {
  const r = norm(draft.from, draft.to);
  const ann: Annotation | null =
    draft.tool === 'arrow'
      ? { id: 'draft', kind: 'arrow', from: draft.from, to: draft.to, color }
      : draft.tool === 'rect' || draft.tool === 'ellipse'
        ? { id: 'draft', kind: draft.tool, rect: r, color }
        : draft.tool === 'pen' && (draft.points?.length ?? 0) > 1
          ? { id: 'draft', kind: 'pen', points: draft.points ?? [], color }
          : null;
  if (ann) return <AnnotationShape a={ann} imageWidth={imageWidth} />;
  return (
    <rect
      class={`ss-imgedit__draft ss-imgedit__draft--${draft.tool}`}
      x={r.x}
      y={r.y}
      width={r.w}
      height={r.h}
      stroke-width={sw / 1.5}
    />
  );
}

function BulkBlurDialog(props: {
  candidates: Step[];
  numbers: Map<string, number>;
  onClose: () => void;
  onApply: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(props.candidates.map((c) => c.id)),
  );
  return (
    <Dialog
      title={s.bulkBlurTitle}
      onClose={props.onClose}
      actions={
        <>
          <Button onClick={props.onClose}>{s.cancel}</Button>
          <Button
            variant="primary"
            disabled={!picked.size}
            onClick={() => props.onApply([...picked])}
          >
            {s.bulkBlurApply}
          </Button>
        </>
      }
    >
      <p class="ss-muted">{props.candidates.length ? s.bulkBlurHint : s.bulkBlurNone}</p>
      <ul class="ss-checklist">
        {props.candidates.map((c) => (
          <li key={c.id}>
            <label class="ss-check">
              <input
                type="checkbox"
                checked={picked.has(c.id)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.currentTarget.checked) next.add(c.id);
                  else next.delete(c.id);
                  setPicked(next);
                }}
              />
              {strings.guide.stepLabel(props.numbers.get(c.id) ?? 0)}: {toPlainText(c.human.title)}
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
