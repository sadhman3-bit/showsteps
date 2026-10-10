import type { AppRef } from '../schema.js';
import type { GuideSummary } from '../storage/types.js';

/** `origin + pathname` with no trailing slash (query and hash ignored), or '' for non-URLs. */
export function pageKey(url: string): string {
  try {
    const u = new URL(url);
    if (!/^(https?|file):$/.test(u.protocol)) return '';
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

export function originOf(url: string): string {
  try {
    const u = new URL(url);
    return /^(https?):$/.test(u.protocol) ? u.origin : u.protocol === 'file:' ? 'file://' : '';
  } catch {
    return '';
  }
}

/** Same page: same origin and path. */
export function samePage(a: string, b: string): boolean {
  const ka = pageKey(a);
  return !!ka && ka === pageKey(b);
}

function webOrigins(apps: AppRef[]): string[] {
  return apps.flatMap((a) => (a.kind === 'web' ? [a.origin] : []));
}

/**
 * Discover (G3): guides recorded on the site in `url`. Guides whose steps use the same origin
 * come first, most recently edited first. Trashed guides are left out.
 */
export function relevantGuides(guides: GuideSummary[], url: string): GuideSummary[] {
  const origin = originOf(url);
  if (!origin) return [];
  return guides
    .filter((g) => !g.trashedAt && webOrigins(g.apps).includes(origin))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
