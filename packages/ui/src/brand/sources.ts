// Brand kits for the UI (B3–B6): where they come from, and a guide's brand with its pictures and
// fonts, ready for an export.
import {
  resolveBrand,
  type BrandKit,
  type BrandStore,
  type Guide,
  type ResolvedBrand,
} from '@showsteps/core';
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';

/** The person's kits, and the team folder's when there is one (read through the host). */
export interface BrandSources {
  personal: BrandStore;
  team?: BrandStore;
}

/** Hosts provide their kit stores; without them every guide keeps ShowSteps's look. */
export const BrandSourcesContext = createContext<() => Promise<BrandSources | undefined>>(
  async () => undefined,
);
export const useBrandSources = () => useContext(BrandSourcesContext);

/** Team kits are listed beside the person's own under ids with this prefix. */
export const TEAM_PREFIX = 'team--';

/** Every kit the person can use: their own, then the team's (marked), and the default. */
export interface KitList {
  kits: BrandKit[];
  teamIds: Set<string>;
  defaultKit?: string;
}

export async function listKits(sources: BrandSources | undefined): Promise<KitList> {
  if (!sources) return { kits: [], teamIds: new Set() };
  const [own, team, defaultKit] = await Promise.all([
    sources.personal.listKits().catch(() => [] as BrandKit[]),
    sources.team?.listKits().catch(() => [] as BrandKit[]) ?? Promise.resolve([] as BrandKit[]),
    sources.personal.getDefault().catch(() => undefined),
  ]);
  const teamKits = team.map((k) => ({ ...k, id: `${TEAM_PREFIX}${k.id}` }));
  return {
    kits: [...own, ...teamKits],
    teamIds: new Set(teamKits.map((k) => k.id)),
    ...(defaultKit ? { defaultKit } : {}),
  };
}

/** A kit's picture or font, from whichever store holds the kit. */
export function kitAsset(
  sources: BrandSources | undefined,
  kitId: string,
  name: string,
): Promise<Uint8Array | undefined> {
  if (!sources) return Promise.resolve(undefined);
  const team = kitId.startsWith(TEAM_PREFIX);
  const store = team ? sources.team : sources.personal;
  return (
    store?.getAsset(team ? kitId.slice(TEAM_PREFIX.length) : kitId, name).catch(() => undefined) ??
    Promise.resolve(undefined)
  );
}

/** A guide's brand, optionally with another kit for this one export. */
export async function brandFor(
  sources: BrandSources | undefined,
  guide: Guide,
  kit?: string,
): Promise<ResolvedBrand> {
  const list = await listKits(sources);
  const g = kit === undefined ? guide : { ...guide, branding: { ...guide.branding, kit } };
  return resolveBrand(g, {
    kits: list.kits,
    ...(list.defaultKit ? { defaultKit: list.defaultKit } : {}),
  });
}
