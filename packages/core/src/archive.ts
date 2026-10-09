import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { createId, nowIso } from './ids.js';
import { GuideFormatError, parseGuide, serializeGuide } from './migrations.js';
import type { Guide } from './schema.js';
import { assertSafeName, type GuideStore } from './storage/types.js';

/** File extension of a Trailmark guide archive (a zip of the guide folder). */
export const ARCHIVE_EXTENSION = '.trailmark';
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

/** Zip a guide and its images: guide.json + img/<name>, the same layout as a library folder. */
export async function exportGuideArchive(store: GuideStore, guideId: string): Promise<Uint8Array> {
  const guide = await store.getGuide(guideId);
  if (!guide) throw new GuideFormatError('That guide no longer exists.');
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

export interface ImportResult {
  guideId: string;
  /** True when the archive's id was already in the library and a new id was assigned. */
  renamed: boolean;
}

/** Read a .trailmark archive into the store. Assigns a fresh id if the guide already exists. */
export async function importGuideArchive(
  store: GuideStore,
  bytes: Uint8Array,
): Promise<ImportResult> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES)
    throw new GuideFormatError('This file is too large to import.');
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new GuideFormatError('This file is not a Trailmark guide.');
  }
  const json = entries['guide.json'];
  if (!json) throw new GuideFormatError('This file is not a Trailmark guide (no guide.json).');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(json));
  } catch {
    throw new GuideFormatError('This guide file is damaged or incomplete.');
  }
  const parsed = parseGuide(raw);
  const renamed = !!(await store.getGuide(parsed.id));
  const guide: Guide = renamed ? { ...parsed, id: createId() } : parsed;
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
