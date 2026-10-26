import {
  BRAND_EXTENSION,
  BRAND_FONTS,
  BrandKitSchema,
  COVER_ELEMENTS,
  LIGHT,
  SHOWSTEPS_KIT,
  checkAsset,
  contrastRatio,
  kitAssets,
  createId,
  exportBrandKit,
  importBrandKit,
  textOn,
  type BrandKit,
  type CoverElement,
} from '@showsteps/core';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Icon } from '../components/Icon.js';
import { downloadBytes, safeFileName } from '../hooks.js';
import { strings } from '../strings.js';
import { BrandPreview } from './BrandPreview.js';
import { TEAM_PREFIX, listKits, type BrandSources, type KitList } from './sources.js';

const b = strings.brandKits;
type Colors = BrandKit['colors'];
type Slot = 'left' | 'centre' | 'right';

/** Pictures are re-drawn as PNG (no metadata, nothing but pixels) before they are kept. */
async function asPng(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } finally {
    bitmap.close();
  }
}

/** A colour pair that's hard to read (under 4.5:1), and what would read. */
function contrastIssue(fg: string, bg: string): string | undefined {
  return contrastRatio(fg, bg) < 4.5 ? textOn(bg) : undefined;
}

/**
 * B4: Settings → Branding. Kits for every export: the list (new, duplicate, delete, default,
 * import, export) and the editor, section by section, with a live preview.
 */
export function BrandSettings(props: { sources: BrandSources; onClose?: () => void }) {
  const { sources } = props;
  const [list, setList] = useState<KitList>({ kits: [], teamIds: new Set() });
  const [selected, setSelected] = useState<string>();
  const [status, setStatus] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const reload = async (select?: string) => {
    const next = await listKits(sources);
    setList(next);
    setSelected((cur) => select ?? cur ?? next.defaultKit ?? next.kits[0]?.id);
  };
  useEffect(() => {
    void reload();
  }, []);
  const kit = list.kits.find((k) => k.id === selected);
  const team = !!kit && list.teamIds.has(kit.id);

  const save = async (next: BrandKit) => {
    const parsed = BrandKitSchema.safeParse(next);
    if (!parsed.success) return setStatus(b.invalid);
    setList((l) => ({ ...l, kits: l.kits.map((k) => (k.id === next.id ? parsed.data : k)) }));
    await sources.personal.saveKit(parsed.data);
    setStatus(b.saved);
  };
  const create = async (from: BrandKit = SHOWSTEPS_KIT) => {
    const id = createId();
    const copy: BrandKit = {
      ...from,
      id,
      name: from === SHOWSTEPS_KIT ? b.newName : b.copyName(from.name),
    };
    await sources.personal.saveKit(copy);
    // A copied kit brings its pictures and fonts (from the team's store for a team kit).
    const fromTeam = from.id.startsWith(TEAM_PREFIX);
    const store = fromTeam ? sources.team : sources.personal;
    const fromId = fromTeam ? from.id.slice(TEAM_PREFIX.length) : from.id;
    for (const name of kitAssets(from)) {
      const bytes = await store?.getAsset(fromId, name);
      if (bytes) await sources.personal.putAsset(id, name, bytes);
    }
    await reload(id);
  };
  const remove = async (id: string) => {
    await sources.personal.deleteKit(id);
    setSelected(undefined);
    await reload();
  };
  const makeDefault = async (id: string | undefined) => {
    await sources.personal.setDefault(id);
    await reload();
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const added = await importBrandKit(
        sources.personal,
        new Uint8Array(await file.arrayBuffer()),
      );
      setStatus(b.imported(added.name));
      await reload(added.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : b.importFailed);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const exportKit = async (k: BrandKit) => {
    const bytes = await exportBrandKit(sources.personal, k.id);
    downloadBytes(bytes, `${safeFileName(k.name)}${BRAND_EXTENSION}`, 'application/zip');
  };

  return (
    <div class="ss-brandkits">
      <section class="ss-brandkits__list" aria-labelledby="ss-brandkits-h">
        <h2 id="ss-brandkits-h">{b.title}</h2>
        <p class="ss-muted">{b.intro}</p>
        <label class="ss-field">
          {b.default}
          <select
            class="ss-input"
            value={list.defaultKit ?? ''}
            onChange={(e) => void makeDefault(e.currentTarget.value || undefined)}
          >
            <option value="">{b.showStepsLook}</option>
            {list.kits.map((k) => (
              <option key={k.id} value={k.id}>
                {list.teamIds.has(k.id) ? strings.share.brandTeam(k.name) : k.name}
              </option>
            ))}
          </select>
        </label>
        <ul class="ss-brandkits__kits" aria-label={b.kits}>
          {list.kits.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                class="ss-brandkits__kit"
                aria-current={k.id === selected ? 'true' : undefined}
                onClick={() => setSelected(k.id)}
              >
                <span
                  class="ss-brandkits__swatch"
                  style={{ background: k.colors.accent }}
                  aria-hidden="true"
                />
                {k.name}
                {list.teamIds.has(k.id) ? <span class="ss-muted"> {b.team}</span> : null}
                {k.id === list.defaultKit ? <span class="ss-muted"> {b.isDefault}</span> : null}
              </button>
            </li>
          ))}
        </ul>
        <div class="ss-row ss-brandkits__actions">
          <Button size="sm" onClick={() => void create()}>
            <Icon name="plus" /> {b.new}
          </Button>
          <Button size="sm" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" /> {b.import}
          </Button>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept={`${BRAND_EXTENSION},application/zip`}
            aria-label={b.import}
            onChange={(e) => void importFile(e.currentTarget.files?.[0])}
          />
        </div>
        <p class="ss-muted" role="status">
          {status}
        </p>
      </section>
      {kit ? (
        <section class="ss-brandkits__editor" aria-label={b.editorLabel(kit.name)}>
          <div class="ss-row ss-brandkits__actions">
            <Button size="sm" onClick={() => void create(kit)}>
              {b.duplicate}
            </Button>
            {!team ? (
              <>
                <Button size="sm" onClick={() => void exportKit(kit)}>
                  {b.export}
                </Button>
                <Button size="sm" variant="danger" onClick={() => void remove(kit.id)}>
                  {b.delete}
                </Button>
              </>
            ) : (
              <p class="ss-muted">{b.teamReadOnly}</p>
            )}
          </div>
          <KitEditor
            key={kit.id}
            kit={kit}
            readOnly={team}
            sources={sources}
            onChange={(next) => void save(next)}
          />
        </section>
      ) : (
        <p class="ss-muted">{b.none}</p>
      )}
    </div>
  );
}

const TOKENS = ['{title}', '{company}', '{page}', '{pages}', '{pageOf}', '{date}', '{author}'];

function KitEditor(props: {
  kit: BrandKit;
  readOnly: boolean;
  sources: BrandSources;
  onChange: (kit: BrandKit) => void;
}) {
  const { kit, readOnly } = props;
  // Changes build on the newest kit, not this render's: a picture converting or a save in
  // flight must not undo a field changed meanwhile.
  const latest = useRef(kit);
  latest.current = kit;
  const change = (next: BrandKit) => {
    latest.current = next;
    props.onChange(next);
  };
  const set = (part: Partial<BrandKit>) => change({ ...latest.current, ...part });
  const setColor = (key: keyof Colors, value: string) =>
    set({ colors: { ...kit.colors, [key]: value } });
  const [assetError, setAssetError] = useState('');

  /** Add a picture or font to the kit; returns its asset name. */
  const addAsset = async (file: File | undefined, kind: 'image' | 'font') => {
    if (!file) return undefined;
    setAssetError('');
    const bytes =
      kind === 'image'
        ? await asPng(file).catch(() => undefined)
        : new Uint8Array(await file.arrayBuffer());
    if (!bytes) {
      setAssetError(b.badPicture);
      return undefined;
    }
    const checked = checkAsset(bytes);
    if ('error' in checked || checked.kind !== kind) {
      setAssetError('error' in checked ? checked.error : b.wrongKind);
      return undefined;
    }
    const ext = kind === 'image' ? 'png' : (/\.(otf|ttf)$/i.exec(file.name)?.[1] ?? 'ttf');
    const name = `${kind}-${Date.now()}.${ext.toLowerCase()}`;
    await props.sources.personal.putAsset(kit.id, name, bytes);
    return name;
  };

  const colors: [keyof Colors, string][] = [
    ['accent', b.colors.accent],
    ['coverBackground', b.colors.coverBackground],
    ['coverText', b.colors.coverText],
    ['headings', b.colors.headings],
    ['links', b.colors.links],
    ['highlight', b.colors.highlight],
  ];
  const issues: { key: keyof Colors; fix: string; message: string }[] = [];
  const check = (key: keyof Colors, bg: string, message: string) => {
    const fix = contrastIssue(kit.colors[key], bg);
    if (fix) issues.push({ key, fix, message });
  };
  if (kit.cover.style !== 'plain') check('coverText', kit.colors.coverBackground, b.lowCover);
  check('headings', LIGHT.surface, b.lowHeadings);
  check('links', LIGHT.surface, b.lowLinks);

  const customFonts = [kit.fonts.body, kit.fonts.heading].filter(
    (f): f is string => !!f?.startsWith('custom:'),
  );
  const fontSelect = (which: 'body' | 'heading', label: string) => (
    <label class="ss-field">
      {label}
      <select
        class="ss-input"
        disabled={readOnly}
        value={kit.fonts[which] ?? ''}
        onChange={async (e) => {
          const v = e.currentTarget.value;
          if (v === '__add') {
            fontInput[which].current?.click();
            return;
          }
          const { [which]: _old, ...rest } = kit.fonts;
          set({ fonts: v ? { ...rest, [which]: v } : rest });
        }}
      >
        <option value="">{which === 'heading' ? b.sameAsBody : b.showStepsType}</option>
        {Object.keys(BRAND_FONTS).map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
        {[...new Set(customFonts)].map((f) => (
          <option key={f} value={f}>
            {b.customFont(f.slice(7))}
          </option>
        ))}
        <option value="__add">{b.addFont}</option>
      </select>
      <input
        ref={fontInput[which]}
        type="file"
        hidden
        accept=".ttf,.otf,font/ttf,font/otf"
        aria-label={b.addFont}
        onChange={async (e) => {
          const name = await addAsset(e.currentTarget.files?.[0], 'font');
          if (name) set({ fonts: { ...latest.current.fonts, [which]: `custom:${name}` } });
          e.currentTarget.value = '';
        }}
      />
    </label>
  );
  const fontInput = {
    body: useRef<HTMLInputElement>(null),
    heading: useRef<HTMLInputElement>(null),
  };

  const picture = (label: string, value: string | undefined, apply: (name?: string) => void) => (
    <div class="ss-field">
      <span>{label}</span>
      <div class="ss-row">
        <label class="ss-button" data-size="sm">
          {value ? b.replacePicture : b.choosePicture}
          <input
            type="file"
            hidden
            disabled={readOnly}
            aria-label={label}
            accept="image/png,image/jpeg,image/webp"
            onChange={async (e) => {
              const name = await addAsset(e.currentTarget.files?.[0], 'image');
              if (name) apply(name);
              e.currentTarget.value = '';
            }}
          />
        </label>
        {value ? (
          <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => apply(undefined)}>
            {b.removePicture}
          </Button>
        ) : null}
      </div>
    </div>
  );
  const without = (key: 'company' | 'logo' | 'logoOnDark'): BrandKit => {
    const { [key]: _gone, ...rest } = latest.current;
    return rest;
  };

  const elements = [
    ...kit.cover.elements,
    ...COVER_ELEMENTS.filter((k) => !kit.cover.elements.some((e) => e.kind === k)).map((kind) => ({
      kind,
      visible: true,
    })),
  ];
  const moveElement = (i: number, by: -1 | 1) => {
    const next = [...elements];
    const [item] = next.splice(i, 1);
    if (item) next.splice(i + by, 0, item);
    set({ cover: { ...kit.cover, elements: next } });
  };
  const showElement = (kind: CoverElement, visible: boolean) =>
    set({
      cover: {
        ...kit.cover,
        elements: elements.map((e) => (e.kind === kind ? { ...e, visible } : e)),
      },
    });

  const slots = (row: 'header' | 'footer') => (
    <fieldset class="ss-fieldset" disabled={readOnly}>
      <legend>{b[row]}</legend>
      {(['left', 'centre', 'right'] as Slot[]).map((slot) => (
        <div key={slot} class="ss-row">
          <label class="ss-field ss-brandkits__slot">
            {b.slots[slot]}
            <input
              class="ss-input"
              maxLength={200}
              value={kit.page[row][slot]}
              onInput={(e) =>
                set({
                  page: { ...kit.page, [row]: { ...kit.page[row], [slot]: e.currentTarget.value } },
                })
              }
            />
          </label>
          <select
            class="ss-input ss-brandkits__token"
            aria-label={b.insertToken(b[row], b.slots[slot])}
            value=""
            onChange={(e) => {
              const token = e.currentTarget.value;
              if (!token) return;
              set({
                page: {
                  ...kit.page,
                  [row]: { ...kit.page[row], [slot]: `${kit.page[row][slot]}${token}` },
                },
              });
            }}
          >
            <option value="">{b.insert}</option>
            {TOKENS.map((t) => (
              <option key={t} value={t}>
                {b.tokens[t as keyof typeof b.tokens]}
              </option>
            ))}
          </select>
        </div>
      ))}
    </fieldset>
  );

  return (
    <div class="ss-brandkits__form">
      <fieldset class="ss-fieldset" disabled={readOnly}>
        <legend>{b.identity}</legend>
        <label class="ss-field">
          {b.name}
          <input
            class="ss-input"
            maxLength={80}
            value={kit.name}
            onInput={(e) => e.currentTarget.value.trim() && set({ name: e.currentTarget.value })}
          />
        </label>
        <label class="ss-field">
          {b.company}
          <input
            class="ss-input"
            maxLength={200}
            value={kit.company ?? ''}
            onInput={(e) => {
              const company = e.currentTarget.value;
              change(company ? { ...latest.current, company } : without('company'));
            }}
          />
        </label>
      </fieldset>

      <fieldset class="ss-fieldset" disabled={readOnly}>
        <legend>{b.colorsTitle}</legend>
        <div class="ss-brandkits__colors">
          {colors.map(([key, label]) => (
            <label key={key} class="ss-field ss-brandkits__color">
              <input
                type="color"
                value={kit.colors[key]}
                onInput={(e) => setColor(key, e.currentTarget.value)}
              />
              {label}
            </label>
          ))}
        </div>
        {issues.map((issue) => (
          <p key={issue.key} class="ss-callout ss-callout--warning" role="alert">
            <Icon name="warning" />
            <span>{issue.message}</span>
            <Button size="sm" onClick={() => setColor(issue.key, issue.fix)}>
              {b.useSuggested}
            </Button>
          </p>
        ))}
      </fieldset>

      <fieldset class="ss-fieldset">
        <legend>{b.fontsTitle}</legend>
        {fontSelect('body', b.bodyFont)}
        {fontSelect('heading', b.headingFont)}
      </fieldset>

      <fieldset class="ss-fieldset" disabled={readOnly}>
        <legend>{b.logosTitle}</legend>
        {picture(b.logo, kit.logo, (name) =>
          change(name ? { ...latest.current, logo: name } : without('logo')),
        )}
        {picture(b.logoOnDark, kit.logoOnDark, (name) =>
          change(name ? { ...latest.current, logoOnDark: name } : without('logoOnDark')),
        )}
        <label class="ss-field">
          {b.logoPlacement}
          <select
            class="ss-input"
            value={kit.logoPlacement}
            onChange={(e) =>
              set({ logoPlacement: e.currentTarget.value as BrandKit['logoPlacement'] })
            }
          >
            {(['cover', 'header', 'both'] as const).map((p) => (
              <option key={p} value={p}>
                {b.placements[p]}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset class="ss-fieldset" disabled={readOnly}>
        <legend>{b.coverTitle}</legend>
        <div class="ss-row">
          <label class="ss-field">
            {b.coverStyle}
            <select
              class="ss-input"
              value={kit.cover.style}
              onChange={(e) =>
                set({
                  cover: {
                    ...kit.cover,
                    style: e.currentTarget.value as BrandKit['cover']['style'],
                  },
                })
              }
            >
              {(['pattern', 'solid', 'plain', 'image'] as const).map((st) => (
                <option key={st} value={st}>
                  {b.coverStyles[st]}
                </option>
              ))}
            </select>
          </label>
          <label class="ss-field">
            {b.coverHeight}
            <select
              class="ss-input"
              value={kit.cover.height}
              onChange={(e) =>
                set({
                  cover: {
                    ...kit.cover,
                    height: e.currentTarget.value as BrandKit['cover']['height'],
                  },
                })
              }
            >
              {(['small', 'medium', 'large'] as const).map((h) => (
                <option key={h} value={h}>
                  {b.heights[h]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {kit.cover.style === 'image'
          ? picture(b.coverImage, kit.cover.image, (name) => {
              const cover = { ...latest.current.cover };
              if (name) cover.image = name;
              else delete cover.image;
              set({ cover });
            })
          : null}
        <p class="ss-muted">{b.coverOrderHint}</p>
        <ol class="ss-brandkits__order" aria-label={b.coverOrder}>
          {elements.map((el, i) => (
            <li key={el.kind}>
              <label class="ss-check">
                <input
                  type="checkbox"
                  checked={el.visible}
                  onChange={(e) => showElement(el.kind, e.currentTarget.checked)}
                />{' '}
                {b.elements[el.kind]}
              </label>
              <Button
                size="sm"
                variant="ghost"
                disabled={i === 0}
                aria-label={b.moveUp(b.elements[el.kind])}
                onClick={() => moveElement(i, -1)}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={i === elements.length - 1}
                aria-label={b.moveDown(b.elements[el.kind])}
                onClick={() => moveElement(i, 1)}
              >
                ↓
              </Button>
            </li>
          ))}
        </ol>
      </fieldset>

      {slots('header')}
      {slots('footer')}
      <fieldset class="ss-fieldset" disabled={readOnly}>
        <legend>{b.pagesTitle}</legend>
        <label class="ss-field">
          {b.notice}
          <input
            class="ss-input"
            maxLength={200}
            placeholder={b.noticePlaceholder}
            value={kit.page.notice ?? ''}
            onInput={(e) => {
              const page = { ...kit.page };
              if (e.currentTarget.value) page.notice = e.currentTarget.value;
              else delete page.notice;
              set({ page });
            }}
          />
        </label>
        <label class="ss-field">
          {b.pageSize}
          <select
            class="ss-input"
            value={kit.page.size}
            onChange={(e) =>
              set({ page: { ...kit.page, size: e.currentTarget.value as 'A4' | 'Letter' } })
            }
          >
            <option value="A4">A4</option>
            <option value="Letter">{b.letter}</option>
          </select>
        </label>
        <label class="ss-field">
          {b.numberStyle}
          <select
            class="ss-input"
            value={kit.steps.numberStyle}
            onChange={(e) =>
              set({
                steps: {
                  ...kit.steps,
                  numberStyle: e.currentTarget.value as BrandKit['steps']['numberStyle'],
                },
              })
            }
          >
            {(['circle', 'square', 'plain'] as const).map((n) => (
              <option key={n} value={n}>
                {b.numberStyles[n]}
              </option>
            ))}
          </select>
        </label>
        <label class="ss-check">
          <input
            type="checkbox"
            checked={kit.steps.pictureBorder}
            onChange={(e) =>
              set({ steps: { ...kit.steps, pictureBorder: e.currentTarget.checked } })
            }
          />{' '}
          {b.pictureBorder}
        </label>
      </fieldset>

      <fieldset class="ss-fieldset" disabled={readOnly}>
        <legend>{b.marksTitle}</legend>
        <p class="ss-muted">{b.marksHint}</p>
        {(['pattern', 'openInLinks', 'agentLine', 'agentData'] as const).map((m) => (
          <label key={m} class="ss-check">
            <input
              type="checkbox"
              checked={kit.marks[m]}
              onChange={(e) => set({ marks: { ...kit.marks, [m]: e.currentTarget.checked } })}
            />{' '}
            {b.marks[m]}
          </label>
        ))}
        <label class="ss-field">
          {b.generator}
          <select
            class="ss-input"
            value={kit.marks.generator}
            onChange={(e) =>
              set({
                marks: {
                  ...kit.marks,
                  generator: e.currentTarget.value as 'showsteps' | 'company',
                },
              })
            }
          >
            <option value="showsteps">{b.generatorShowSteps}</option>
            <option value="company">{b.generatorCompany}</option>
          </select>
        </label>
      </fieldset>
      {assetError ? (
        <p class="ss-callout ss-callout--warning" role="alert">
          <Icon name="warning" />
          <span>{assetError}</span>
        </p>
      ) : null}
      <BrandPreview kit={kit} sources={props.sources} />
    </div>
  );
}

/** The Branding page: Back to the library, then the kits. */
export function BrandPage(props: { sources: BrandSources | undefined; onBack: () => void }) {
  return (
    <main class="ss-page ss-brandpage">
      <nav class="ss-guide__nav">
        <Button variant="ghost" onClick={props.onBack}>
          <Icon name="back" /> {strings.guide.back}
        </Button>
      </nav>
      {props.sources ? <BrandSettings sources={props.sources} /> : <p class="ss-muted">{b.none}</p>}
    </main>
  );
}
