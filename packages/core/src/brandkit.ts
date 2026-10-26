// Brand kits (B1): how every export looks, set once for the library and swapped piece by piece.
// ShowSteps's own kit is today's look, so nothing changes for anyone who sets nothing up.
import { z } from 'zod';
import { BRAND_FONTS, DEFAULT_ACCENT, HIGHLIGHT_COLOR, isHexColor } from './branding.js';
import type { Guide } from './schema.js';
import { CHROME, LIGHT } from './tokens.js';

const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);
/** Text a kit writes on pages: one line, at most 200 characters. */
const Line = z
  .string()
  .max(200)
  .transform((s) => s.replace(/[\r\n\u2028\u2029]+/g, ' '));
/** A picture or font in the kit's own store (a safe file name). */
const Asset = z.string().regex(/^[A-Za-z0-9._-]{1,120}$/);
/** A font from BRAND_FONTS, or `custom:<asset>` (a TTF or OTF the person added). */
const Font = z.string().max(140);

export const COVER_ELEMENTS = [
  'title',
  'links',
  'logo',
  'description',
  'meta',
  'preconditions',
] as const;
export type CoverElement = (typeof COVER_ELEMENTS)[number];

const Slots = z.object({ left: Line, centre: Line, right: Line });

export const BrandKitSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  name: z.string().min(1).max(80),
  /** Used in header and footer tokens and, when chosen, as the file's creator. */
  company: Line.optional(),
  colors: z.object({
    accent: Hex,
    coverBackground: Hex,
    coverText: Hex,
    headings: Hex,
    links: Hex,
    /** The ring round the clicked element in pictures. */
    highlight: Hex,
  }),
  fonts: z.object({ heading: Font.optional(), body: Font.optional() }),
  logo: Asset.optional(),
  /** For dark covers (`solid`, `pattern`, `image`); `logo` is used when there is none. */
  logoOnDark: Asset.optional(),
  logoPlacement: z.enum(['cover', 'header', 'both']),
  cover: z.object({
    style: z.enum(['pattern', 'solid', 'plain', 'image']),
    height: z.enum(['small', 'medium', 'large']),
    image: Asset.optional(),
    elements: z
      .array(z.object({ kind: z.enum(COVER_ELEMENTS), visible: z.boolean() }))
      .max(COVER_ELEMENTS.length),
  }),
  page: z.object({
    header: Slots,
    footer: Slots,
    /** "Confidential: internal use only", on every page after the cover. */
    notice: Line.optional(),
    size: z.enum(['A4', 'Letter']),
  }),
  steps: z.object({
    numberStyle: z.enum(['circle', 'square', 'plain']),
    pictureBorder: z.boolean(),
  }),
  /** ShowSteps's own marks in exports, each of which a kit can drop. */
  marks: z.object({
    /** The trail pattern on the cover (`pattern` style). */
    pattern: z.boolean(),
    /** "Open in ShowSteps: Guide Me · Run for me" under the title (the Share toggle still wins). */
    openInLinks: z.boolean(),
    /** The visible line "Agent-readable procedure embedded". */
    agentLine: z.boolean(),
    /** The procedure attached to PDF and Word files, for agents. */
    agentData: z.boolean(),
    /** The file's creator, producer and `generator`: ShowSteps, or the company (or nothing). */
    generator: z.enum(['showsteps', 'company']),
  }),
});
export type BrandKit = z.infer<typeof BrandKitSchema>;
/** A brand kit with every field: what exporters draw with. */
export type ResolvedBrand = BrandKit & { logoFrom?: LogoSource };

/** Where a resolved logo's bytes are: the guide's own pictures, or a kit's store. */
export type LogoSource =
  { from: 'guide'; name: string } | { from: 'kit'; kitId: string; name: string };

type Patch<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : Patch<T[K]>) : T[K];
};
/** Changes on top of a kit: any field, any depth. */
export type BrandPatch = Patch<Omit<BrandKit, 'id' | 'name'>>;

const K = BrandKitSchema.shape;
/** Changes on top of a kit, as stored in a guide: any field, any depth. */
export const BrandPatchSchema = z.object({
  company: K.company,
  colors: K.colors.partial().optional(),
  fonts: K.fonts.optional(),
  logo: K.logo,
  logoOnDark: K.logoOnDark,
  logoPlacement: K.logoPlacement.optional(),
  cover: K.cover.partial().optional(),
  page: z
    .object({
      header: Slots.partial().optional(),
      footer: Slots.partial().optional(),
      notice: K.page.shape.notice,
      size: K.page.shape.size.optional(),
    })
    .optional(),
  steps: K.steps.partial().optional(),
  marks: K.marks.partial().optional(),
});

/** The page footer today: the title on the left, "Page n of m" on the right. */
export const PAGE_OF = '{pageOf}';

/** ShowSteps's own kit: exactly what exports looked like before brand kits. */
export const SHOWSTEPS_KIT: BrandKit = {
  id: 'showsteps',
  name: 'ShowSteps',
  colors: {
    accent: DEFAULT_ACCENT,
    coverBackground: CHROME.bg,
    coverText: CHROME.fg,
    headings: LIGHT.text,
    links: DEFAULT_ACCENT,
    highlight: HIGHLIGHT_COLOR,
  },
  fonts: {},
  logoPlacement: 'cover',
  cover: {
    style: 'pattern',
    height: 'medium',
    elements: COVER_ELEMENTS.map((kind) => ({ kind, visible: true })),
  },
  page: {
    header: { left: '', centre: '', right: '' },
    footer: { left: '{title}', centre: '', right: PAGE_OF },
    size: 'A4',
  },
  steps: { numberStyle: 'circle', pictureBorder: true },
  marks: {
    pattern: true,
    openInLinks: true,
    agentLine: true,
    agentData: true,
    generator: 'showsteps',
  },
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `base` with `patch` laid over it, at any depth (arrays are replaced, not merged). */
export function applyBrandPatch<T>(base: T, patch: unknown): T {
  if (!isObject(patch) || !isObject(base)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isObject(v) && isObject(out[k]) ? applyBrandPatch(out[k], v) : v;
  }
  return out as T;
}

/** The kits a library knows, for resolving a guide's brand. */
export interface BrandContext {
  kits: readonly BrandKit[];
  /** The library's default kit. */
  defaultKit?: string;
  /** The team folder's kit, when the person follows it. */
  teamKit?: BrandKit;
}

/**
 * A guide's brand. Later wins: ShowSteps's kit, the library's default, the team's kit, the kit
 * the guide names (each a whole kit), then the guide's own settings on top (the 1.2 logo, accent
 * and font, then its overrides).
 */
export function resolveBrand(
  guide: Pick<Guide, 'branding'>,
  ctx: BrandContext = { kits: [] },
): ResolvedBrand {
  // `showsteps` names ShowSteps's own kit, so a guide can opt out of the library's default.
  const find = (id: string | undefined) =>
    id === SHOWSTEPS_KIT.id ? SHOWSTEPS_KIT : id ? ctx.kits.find((k) => k.id === id) : undefined;
  const chain = [find(ctx.defaultKit), ctx.teamKit, find(guide.branding?.kit)].filter(
    (k): k is BrandKit => !!k,
  );
  let brand: ResolvedBrand = SHOWSTEPS_KIT;
  // Each kit is complete: a later one replaces the earlier one, logo and all.
  for (const kit of chain) {
    const { logoFrom: _l, ...rest } = { ...SHOWSTEPS_KIT, ...kit } as ResolvedBrand;
    brand = kit.logo ? { ...rest, logoFrom: { from: 'kit', kitId: kit.id, name: kit.logo } } : rest;
  }
  const b = guide.branding;
  if (b) {
    if (isHexColor(b.accent))
      brand = applyBrandPatch(brand, { colors: { accent: b.accent, links: b.accent } });
    if (b.font && BRAND_FONTS[b.font])
      brand = applyBrandPatch(brand, { fonts: { body: b.font, heading: b.font } });
    if (b.logo)
      brand = { ...brand, logoFrom: { from: 'guide', name: b.logo.replace(/^img\//, '') } };
    if (b.overrides) brand = applyBrandPatch(brand, b.overrides);
  }
  return brand;
}

/** What header and footer tokens stand for on one page. */
export interface TokenValues {
  title: string;
  company?: string;
  page: number;
  pages: number;
  date: string;
  author?: string;
  /** "Page 3 of 9", in the export's language. */
  pageOf: string;
}

/** `{title}`, `{company}`, `{page}`, `{pages}`, `{date}`, `{author}` and `{pageOf}` filled in. */
export function expandTokens(template: string, v: TokenValues): string {
  return template.replace(/\{(title|company|page|pages|date|author|pageOf)\}/g, (_m, k: string) => {
    switch (k) {
      case 'title':
        return v.title;
      case 'company':
        return v.company ?? '';
      case 'page':
        return String(v.page);
      case 'pages':
        return String(v.pages);
      case 'date':
        return v.date;
      case 'author':
        return v.author ?? '';
      default:
        return v.pageOf;
    }
  });
}

/** Cover elements in the kit's order, visible ones only; any the kit leaves out come last. */
export function coverOrder(brand: Pick<BrandKit, 'cover'>): CoverElement[] {
  const listed = brand.cover.elements.map((e) => e.kind);
  const missing = COVER_ELEMENTS.filter((k) => !listed.includes(k)).map((kind) => ({
    kind,
    visible: true,
  }));
  return [...brand.cover.elements, ...missing].filter((e) => e.visible).map((e) => e.kind);
}

/** Whether a brand is ShowSteps's own look (exports then stay exactly as before). */
export function isShowStepsLook(brand: ResolvedBrand): boolean {
  const { logoFrom: _l, ...rest } = brand;
  return (
    JSON.stringify({ ...rest, id: 'showsteps', name: 'ShowSteps' }) ===
    JSON.stringify(SHOWSTEPS_KIT)
  );
}
