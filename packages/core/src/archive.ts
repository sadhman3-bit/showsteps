import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { createId, nowIso } from './ids.js';
import { GuideFormatError, parseGuide, serializeGuide } from './migrations.js';
import type { Annotation, Block, Guide, Point, Rect, Step } from './schema.js';
import { markReceived, rearmConfirms, trustGuide, type ReceivedFrom } from './guidance/received.js';
import { thumbNameFor } from './storage/summary.js';
import { assertSafeName, type GuideStore } from './storage/types.js';

/** File extension of a ShowSteps guide archive (a zip of the guide folder). */
export const ARCHIVE_EXTENSION = '.showsteps';
/** File types the import picker offers: archives saved before the rename end in .trailmark. */
export const ARCHIVE_ACCEPT = `${ARCHIVE_EXTENSION},.trailmark,application/zip`;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

/** A step's picture with its blurs (and crop) burned in, for a file that leaves the person. */
export interface RedactedImage {
  full: Uint8Array;
  thumb?: Uint8Array;
  /** File extension of `full` and `thumb` (`webp` or `png`). */
  ext: string;
  width: number;
  height: number;
  /** Where the new picture starts in the old one, and its size relative to it. */
  origin: { x: number; y: number };
  scale: number;
}

/** Burns a step's blurs and crop into its stored picture; the UI provides it (core has no canvas). */
export type Redactor = (
  step: Step,
  image: Uint8Array,
  name: string,
) => Promise<RedactedImage | undefined>;

export interface ArchiveOptions {
  /**
   * `share`: for a file that leaves the person (Share, Export): blurs and crops burned into the
   * pictures, no page-text files, only pictures the steps use, no editor history or tab IDs.
   * `backup`: everything as stored, including what is under the blurs.
   */
  mode: 'share' | 'backup';
  /** Required for `share`. */
  redact?: Redactor;
}

const imageName = (file: string) => file.replace(/^img\//, '');

function moveAnnotation(a: Annotation, at: (p: Point) => Point, k: number): Annotation {
  const rect = (r: Rect): Rect => ({ ...at(r), w: r.w * k, h: r.h * k });
  switch (a.kind) {
    case 'arrow':
      return { ...a, from: at(a.from), to: at(a.to) };
    case 'rect':
    case 'ellipse':
      return { ...a, rect: rect(a.rect) };
    case 'text':
      return { ...a, at: at(a.at), ...(a.size ? { size: a.size * k } : {}) };
    case 'pen':
      return { ...a, points: a.points.map(at), ...(a.width ? { width: a.width * k } : {}) };
    case 'badge':
      return { ...a, at: at(a.at) };
  }
}

/** The step with its new, redacted picture: geometry moved into the new picture, no blurs. */
function redactedStep(step: Step, file: string, img: RedactedImage): Step {
  const { origin, scale: k } = img;
  const at = (p: Point): Point => ({ x: (p.x - origin.x) * k, y: (p.y - origin.y) * k });
  const dpr = step.human.screenshot?.dpr ?? 1;
  const { original: _o, ...human } = step.human;
  const box = step.human.actionBox;
  return {
    ...step,
    human: {
      ...human,
      screenshot: { file, width: img.width, height: img.height, dpr },
      ...(box ? { actionBox: { ...at(box), w: box.w * k, h: box.h * k } } : {}),
      annotations: step.human.annotations.map((a) => moveAnnotation(a, at, k)),
      blurs: [],
    },
  };
}

/** Zip a guide and its images: guide.json + img/<name>, the same layout as a library folder. */
export async function exportGuideArchive(
  store: GuideStore,
  guideId: string,
  options: ArchiveOptions,
): Promise<Uint8Array> {
  const guide = await store.getGuide(guideId);
  if (!guide) throw new GuideFormatError('That guide no longer exists.');
  if (options.mode === 'share') return shareArchive(store, guide, options.redact);
  const files: Zippable = { 'guide.json': strToU8(serializeGuide(guide)) };
  const img: Record<string, Uint8Array> = {};
  for (const name of await store.listImages(guideId)) {
    const data = await store.getImage(guideId, name);
    if (data) img[name] = data;
  }
  if (Object.keys(img).length) files.img = img;
  // Images are already compressed (WebP/PNG); store them, deflate only the JSON.
  return zipSync(files, { level: 0 });
}

/** A stored picture with nothing hidden in it, with its stored thumbnail, unchanged. */
async function asStored(
  store: GuideStore,
  guideId: string,
  file: string,
  full: Uint8Array,
  shot: { width: number; height: number },
): Promise<RedactedImage> {
  const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1] ?? 'webp';
  const thumb = await store.getImage(guideId, thumbNameFor(file));
  return {
    full,
    ...(thumb ? { thumb } : {}),
    ext,
    width: shot.width,
    height: shot.height,
    origin: { x: 0, y: 0 },
    scale: 1,
  };
}

/** A copy fit to leave the computer: nothing that was hidden, nothing the guide doesn't show. */
async function shareArchive(
  store: GuideStore,
  guide: Guide,
  redact: Redactor | undefined,
): Promise<Uint8Array> {
  if (!redact) throw new Error('A shared guide file needs its pictures redacted.');
  const img: Record<string, Uint8Array> = {};
  const blocks: Block[] = [];
  for (const b of guide.blocks) {
    if (b.kind !== 'step') {
      blocks.push(b);
      continue;
    }
    const { tabId: _t, ...capture } = b.capture;
    let step: Step = { ...b, capture };
    const shot = b.human.screenshot;
    const file = shot ? imageName(shot.file) : undefined;
    const bytes = file ? await store.getImage(guide.id, file) : undefined;
    // Nothing blurred or cropped away: the stored picture shows only what the guide shows, so
    // it goes as it is (re-encoding every picture made sharing slow).
    const plain = !!shot && !b.human.blurs.length && !(shot.crop && (shot.zoom ?? 1) > 1);
    const done =
      file && bytes
        ? plain
          ? await asStored(store, guide.id, file, bytes, shot)
          : await redact(b, bytes, file)
        : undefined;
    if (done) {
      const name = assertSafeName(`${b.id}.${done.ext}`, 'image name');
      img[name] = done.full;
      if (done.thumb) img[thumbNameFor(name)] = done.thumb;
      step = redactedStep(step, `img/${name}`, done);
    } else {
      // No picture to redact: leave it out rather than ship it as stored.
      const { screenshot: _s, actionBox: _a, original: _o, ...human } = step.human;
      step = { ...step, human: { ...human, annotations: [], blurs: [] } };
    }
    blocks.push(step);
  }
  const logo = guide.branding?.logo;
  if (logo) {
    const data = await store.getImage(guide.id, logo);
    if (data) img[logo] = data;
  }
  const { updatedBy: _u, ...rest } = guide;
  const clean: Guide = { ...rest, blocks };
  const files: Zippable = { 'guide.json': strToU8(serializeGuide(clean)) };
  if (Object.keys(img).length) files.img = img;
  return zipSync(files, { level: 0 });
}

export interface ImportResult {
  guideId: string;
  /** True when the archive's id was already in the library and a new id was assigned. */
  renamed: boolean;
}

/** Limits on what a guide file may unpack to (H8): a small file can't expand without bound. */
export const ARCHIVE_LIMITS = {
  entries: 5_000,
  guideJson: 20 * 1024 * 1024,
  total: 600 * 1024 * 1024,
} as const;

const isSafeName = (name: string) => {
  try {
    return !!assertSafeName(name);
  } catch {
    return false;
  }
};

/**
 * Checks each entry before it is decompressed, using the sizes the zip declares: only
 * `guide.json` and pictures under `img/` with safe names, within ARCHIVE_LIMITS.
 */
function entryFilter(): (file: { name: string; originalSize: number }) => boolean {
  let count = 0;
  let total = 0;
  return (file) => {
    if (++count > ARCHIVE_LIMITS.entries)
      throw new GuideFormatError('This guide file has too many files in it to import.');
    if (file.name === 'img/') return false;
    if (file.name === 'guide.json') {
      if (file.originalSize > ARCHIVE_LIMITS.guideJson)
        throw new GuideFormatError('This guide file is too large to import.');
    } else {
      const name = /^img\/([^/]+)$/.exec(file.name)?.[1];
      if (!name || !isSafeName(name))
        throw new GuideFormatError(
          `This isn't a ShowSteps guide file: it holds "${file.name.slice(0, 80)}".`,
        );
    }
    total += file.originalSize;
    if (total > ARCHIVE_LIMITS.total)
      throw new GuideFormatError('This guide file unpacks to more than ShowSteps imports.');
    return true;
  };
}

/** Who an imported guide is from (H4): someone else unless the caller says otherwise. */
export interface ImportOptions {
  /** `false`: ShowSteps's own samples, or a copy of the person's own guide. */
  received?: { from: ReceivedFrom; file?: string } | false;
}

/**
 * Read a .showsteps archive into the store. Assigns a fresh id if the guide already exists.
 * Steps whose control can't be undone ask before acting again, whatever the file said, and the
 * guide is marked as received from someone else (H4).
 */
export async function importGuideArchive(
  store: GuideStore,
  bytes: Uint8Array,
  options: ImportOptions = {},
): Promise<ImportResult> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES)
    throw new GuideFormatError('This file is too large to import.');
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: entryFilter() });
  } catch (error) {
    if (error instanceof GuideFormatError) throw error;
    throw new GuideFormatError('This file is not a ShowSteps guide.');
  }
  const json = entries['guide.json'];
  if (!json) throw new GuideFormatError('This file is not a ShowSteps guide (no guide.json).');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(json));
  } catch {
    throw new GuideFormatError('This guide file is damaged or incomplete.');
  }
  const parsed = rearmConfirms(parseGuide(raw));
  const received = options.received ?? { from: 'import' };
  const marked = received
    ? markReceived(parsed, received.from, nowIso(), received.file)
    : trustGuide(parsed);
  const renamed = !!(await store.getGuide(parsed.id));
  const guide: Guide = renamed ? { ...marked, id: createId() } : marked;
  for (const [path, data] of Object.entries(entries)) {
    const m = /^img\/([^/]+)$/.exec(path);
    if (!m?.[1]) continue;
    await store.putImage(guide.id, assertSafeName(m[1], 'image name'), data);
  }
  await store.saveGuide(guide);
  return { guideId: guide.id, renamed };
}

/** Copy a guide (and its images) under a new id and title. */
export async function duplicateGuide(
  store: GuideStore,
  guideId: string,
  title: string,
): Promise<string> {
  const source = await store.getGuide(guideId);
  if (!source) throw new GuideFormatError('That guide no longer exists.');
  const at = nowIso();
  const copy: Guide = {
    ...structuredClone(source),
    id: createId(),
    title,
    createdAt: at,
    updatedAt: at,
  };
  for (const name of await store.listImages(guideId)) {
    const data = await store.getImage(guideId, name);
    if (data) await store.putImage(copy.id, name, data);
  }
  await store.saveGuide(copy);
  return copy.id;
}
