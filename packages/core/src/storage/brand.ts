// Brand kits on disk and in the browser (B3), and the `.showsteps-brand` file that shares one.
import fontkit from '@pdf-lib/fontkit';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { BrandKitSchema, type BrandKit } from '../brandkit.js';
import { createId } from '../ids.js';
import { GuideFormatError } from '../migrations.js';
import type { FileSystem } from './folder.js';
import { assertSafeName } from './types.js';

/** Where a library keeps its brand kits and their pictures and fonts. */
export interface BrandStore {
  listKits(): Promise<BrandKit[]>;
  saveKit(kit: BrandKit): Promise<void>;
  deleteKit(id: string): Promise<void>;
  /** The kit every guide uses unless it names another. */
  getDefault(): Promise<string | undefined>;
  setDefault(id: string | undefined): Promise<void>;
  putAsset(kitId: string, name: string, bytes: Uint8Array): Promise<void>;
  getAsset(kitId: string, name: string): Promise<Uint8Array | undefined>;
}

/** The methods the desktop app answers over the bridge (capability `brand-kits`). */
export const BRAND_STORE_METHODS = [
  'listKits',
  'saveKit',
  'deleteKit',
  'getDefault',
  'setDefault',
  'putAsset',
  'getAsset',
] as const satisfies readonly (keyof BrandStore)[];

/** What a kit's asset may be: a PNG, JPEG or WebP picture, or a TrueType or OpenType font. */
export type AssetKind = 'image' | 'font';
export const MAX_IMAGE_ASSET = 5 * 1024 * 1024;
export const MAX_FONT_ASSET = 2 * 1024 * 1024;

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

/**
 * The asset's kind from its bytes, or why it isn't accepted. SVG and anything else is refused;
 * fonts must load.
 */
export function checkAsset(bytes: Uint8Array): { kind: AssetKind } | { error: string } {
  const png = startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]);
  const jpeg = startsWith(bytes, [0xff, 0xd8, 0xff]);
  const webp =
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  if (png || jpeg || webp)
    return bytes.length > MAX_IMAGE_ASSET
      ? { error: 'Pictures can be at most 5 MB.' }
      : { kind: 'image' };
  const font =
    startsWith(bytes, [0x00, 0x01, 0x00, 0x00]) ||
    startsWith(bytes, [0x4f, 0x54, 0x54, 0x4f]) || // OTTO
    startsWith(bytes, [0x74, 0x72, 0x75, 0x65]); // true
  if (font) {
    if (bytes.length > MAX_FONT_ASSET) return { error: 'Fonts can be at most 2 MB.' };
    try {
      fontkit.create(bytes);
      return { kind: 'font' };
    } catch {
      return { error: 'This font file can’t be read.' };
    }
  }
  return { error: 'Use a PNG, JPEG or WebP picture, or a TTF or OTF font.' };
}

/** The assets a kit refers to. */
export function kitAssets(kit: BrandKit): string[] {
  const fonts = [kit.fonts.body, kit.fonts.heading]
    .filter((f): f is string => !!f?.startsWith('custom:'))
    .map((f) => f.slice(7));
  return [
    ...new Set(
      [kit.logo, kit.logoOnDark, kit.cover.image, ...fonts].filter((a): a is string => !!a),
    ),
  ];
}

// ---------- IndexedDB (the extension) ----------

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** Kits in IndexedDB database `showsteps-brand`: stores `kits`, `assets` and `meta`. */
export class IndexedDbBrandStore implements BrandStore {
  private db: Promise<IDBDatabase> | undefined;

  constructor(
    private readonly factory: IDBFactory,
    private readonly name = 'showsteps-brand',
  ) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const r = this.factory.open(this.name, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('kits', { keyPath: 'id' });
        r.result.createObjectStore('assets');
        r.result.createObjectStore('meta');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return this.db;
  }

  private async store(name: string, mode: IDBTransactionMode = 'readonly') {
    return (await this.open()).transaction(name, mode).objectStore(name);
  }

  async listKits(): Promise<BrandKit[]> {
    const all = (await req((await this.store('kits')).getAll())) as unknown[];
    return all.flatMap((k) => {
      const parsed = BrandKitSchema.safeParse(k);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async saveKit(kit: BrandKit): Promise<void> {
    await req((await this.store('kits', 'readwrite')).put(BrandKitSchema.parse(kit)));
  }

  async deleteKit(id: string): Promise<void> {
    await req((await this.store('kits', 'readwrite')).delete(id));
    const assets = await this.store('assets', 'readwrite');
    // No IDBKeyRange: core uses only the factory it is given.
    for (const key of (await req(assets.getAllKeys())) as IDBValidKey[])
      if (typeof key === 'string' && key.startsWith(`${id}/`)) await req(assets.delete(key));
    if ((await this.getDefault()) === id) await this.setDefault(undefined);
  }

  async getDefault(): Promise<string | undefined> {
    return (await req((await this.store('meta')).get('default'))) as string | undefined;
  }

  async setDefault(id: string | undefined): Promise<void> {
    const meta = await this.store('meta', 'readwrite');
    if (id) await req(meta.put(id, 'default'));
    else await req(meta.delete('default'));
  }

  async putAsset(kitId: string, name: string, bytes: Uint8Array): Promise<void> {
    assertSafeName(name, 'asset name');
    await req((await this.store('assets', 'readwrite')).put(bytes, `${kitId}/${name}`));
  }

  async getAsset(kitId: string, name: string): Promise<Uint8Array | undefined> {
    const v = await req((await this.store('assets')).get(`${kitId}/${name}`));
    return v instanceof Uint8Array ? v : undefined;
  }
}

// ---------- A folder (the desktop app, a team folder) ----------

/**
 * Kits in a folder: `<root>/<kit id>/kit.json` and `<root>/<kit id>/assets/<name>`, with
 * `<root>/default.json` naming the default. A team folder keeps its kit in `.brand`.
 */
export class FolderBrandStore implements BrandStore {
  constructor(
    private readonly fs: FileSystem,
    private readonly root: string,
  ) {}

  private path(...parts: string[]): string {
    return [this.root, ...parts].join('/');
  }

  async listKits(): Promise<BrandKit[]> {
    const out: BrandKit[] = [];
    for (const name of await this.fs.readdir(this.root)) {
      if (name === 'default.json' || name.startsWith('.')) continue;
      const raw = await this.fs.readFile(this.path(name, 'kit.json'));
      if (!raw) continue; // not a kit folder
      try {
        const parsed = BrandKitSchema.safeParse(JSON.parse(strFromU8(raw)));
        if (parsed.success) out.push(parsed.data);
      } catch {
        // a damaged kit.json: left out
      }
    }
    return out;
  }

  async saveKit(kit: BrandKit): Promise<void> {
    const parsed = BrandKitSchema.parse(kit);
    assertSafeName(parsed.id, 'kit id');
    await this.fs.mkdir(this.path(parsed.id, 'assets'));
    await this.fs.writeFile(
      this.path(parsed.id, 'kit.json'),
      strToU8(`${JSON.stringify(parsed, null, 2)}\n`),
    );
  }

  async deleteKit(id: string): Promise<void> {
    assertSafeName(id, 'kit id');
    await this.fs.remove(this.path(id));
    if ((await this.getDefault()) === id) await this.setDefault(undefined);
  }

  async getDefault(): Promise<string | undefined> {
    const raw = await this.fs.readFile(this.path('default.json'));
    if (!raw) return undefined;
    try {
      const v = JSON.parse(strFromU8(raw)) as { kit?: unknown };
      return typeof v.kit === 'string' ? v.kit : undefined;
    } catch {
      return undefined;
    }
  }

  async setDefault(id: string | undefined): Promise<void> {
    if (!id) return this.fs.remove(this.path('default.json'));
    await this.fs.mkdir(this.root);
    await this.fs.writeFile(this.path('default.json'), strToU8(JSON.stringify({ kit: id })));
  }

  async putAsset(kitId: string, name: string, bytes: Uint8Array): Promise<void> {
    assertSafeName(kitId, 'kit id');
    assertSafeName(name, 'asset name');
    await this.fs.mkdir(this.path(kitId, 'assets'));
    await this.fs.writeFile(this.path(kitId, 'assets', name), bytes);
  }

  async getAsset(kitId: string, name: string): Promise<Uint8Array | undefined> {
    try {
      assertSafeName(kitId, 'kit id');
      assertSafeName(name, 'asset name');
      return await this.fs.readFile(this.path(kitId, 'assets', name));
    } catch {
      return undefined;
    }
  }
}

// ---------- .showsteps-brand files ----------

export const BRAND_EXTENSION = '.showsteps-brand';
const BRAND_LIMITS = { entries: 20, total: 16 * 1024 * 1024 } as const;

/** A kit and the assets it uses, zipped, to share with others (no guide content). */
export async function exportBrandKit(store: BrandStore, id: string): Promise<Uint8Array> {
  const kit = (await store.listKits()).find((k) => k.id === id);
  if (!kit) throw new GuideFormatError('That brand kit no longer exists.');
  const assets: Record<string, Uint8Array> = {};
  for (const name of kitAssets(kit)) {
    const bytes = await store.getAsset(id, name);
    if (bytes) assets[name] = bytes;
  }
  const files: Zippable = { 'kit.json': strToU8(JSON.stringify(kit, null, 2)) };
  if (Object.keys(assets).length) files.assets = assets;
  return zipSync(files, { level: 6 });
}

/**
 * Add a shared kit to the store, under a new id. Only `kit.json` and the pictures and fonts it
 * refers to are accepted, each checked; anything else refuses the whole file.
 */
export async function importBrandKit(store: BrandStore, bytes: Uint8Array): Promise<BrandKit> {
  let count = 0;
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (++count > BRAND_LIMITS.entries || (total += file.originalSize) > BRAND_LIMITS.total)
          throw new GuideFormatError('This brand file is too large.');
        if (file.name === 'assets/') return false;
        if (file.name !== 'kit.json' && !/^assets\/[A-Za-z0-9._-]{1,120}$/.test(file.name))
          throw new GuideFormatError('This isn’t a ShowSteps brand file.');
        return true;
      },
    });
  } catch (error) {
    if (error instanceof GuideFormatError) throw error;
    throw new GuideFormatError('This isn’t a ShowSteps brand file.');
  }
  const json = entries['kit.json'];
  if (!json) throw new GuideFormatError('This isn’t a ShowSteps brand file.');
  let kit: BrandKit;
  try {
    kit = BrandKitSchema.parse(JSON.parse(strFromU8(json)));
  } catch {
    throw new GuideFormatError('This brand file is damaged.');
  }
  const wanted = new Set(kitAssets(kit));
  for (const [path, data] of Object.entries(entries)) {
    if (path === 'kit.json') continue;
    const name = path.slice('assets/'.length);
    if (!wanted.has(name)) throw new GuideFormatError('This isn’t a ShowSteps brand file.');
    const checked = checkAsset(data);
    if ('error' in checked) throw new GuideFormatError(checked.error);
  }
  const existing = await store.listKits();
  const id = existing.some((k) => k.id === kit.id) ? createId() : kit.id;
  const added: BrandKit = { ...kit, id };
  await store.saveKit(added);
  for (const name of wanted) {
    const data = entries[`assets/${name}`];
    if (data) await store.putAsset(id, name, data);
  }
  return added;
}
