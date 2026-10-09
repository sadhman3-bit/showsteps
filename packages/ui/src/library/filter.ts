import type { AppRef, Folder, GuideSummary } from '@trailmark/core';

export type SortKey = 'updated' | 'created' | 'title' | 'steps';
export type Scope = { kind: 'all' } | { kind: 'trash' } | { kind: 'folder'; folderId: string };

export interface LibraryQuery {
  scope: Scope;
  text: string;
  sort: SortKey;
  /** App filter value from `appKey`. */
  app?: string;
  tag?: string;
}

/** Stable key and label for a site or desktop app. */
export function appKey(ref: AppRef): string {
  return ref.kind === 'web' ? ref.origin : `desktop:${ref.processName.toLowerCase()}`;
}

export function appLabel(ref: AppRef): string {
  if (ref.kind === 'desktop') return ref.processName.replace(/\.exe$/i, '');
  try {
    return new URL(ref.origin).host;
  } catch {
    return ref.origin;
  }
}

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Every word of the query must appear in the title, description, tags or step text. */
export function matchesText(g: GuideSummary, text: string): boolean {
  const words = fold(text).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([g.title, g.description ?? '', g.tags.join(' '), g.searchText].join('\n'));
  return words.every((w) => hay.includes(w));
}

const byKey: Record<SortKey, (a: GuideSummary, b: GuideSummary) => number> = {
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
  title: (a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }),
  steps: (a, b) => b.stepCount - a.stepCount || a.title.localeCompare(b.title),
};

/** The guides to show for a scope, search, filters and sort order. */
export function filterGuides(all: readonly GuideSummary[], q: LibraryQuery): GuideSummary[] {
  return all
    .filter((g) => {
      if (q.scope.kind === 'trash') return !!g.trashedAt;
      if (g.trashedAt) return false;
      if (q.scope.kind === 'folder') return g.folderId === q.scope.folderId;
      return true;
    })
    .filter((g) => matchesText(g, q.text))
    .filter((g) => !q.app || g.apps.some((a) => appKey(a) === q.app))
    .filter((g) => !q.tag || g.tags.includes(q.tag))
    .sort(
      q.scope.kind === 'trash'
        ? (a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? '')
        : byKey[q.sort],
    );
}

/** Distinct apps and tags across live guides, for the filter menus. */
export function facets(all: readonly GuideSummary[]): {
  apps: { key: string; label: string }[];
  tags: string[];
} {
  const apps = new Map<string, string>();
  const tags = new Set<string>();
  for (const g of all) {
    if (g.trashedAt) continue;
    for (const a of g.apps) apps.set(appKey(a), appLabel(a));
    for (const t of g.tags) tags.add(t);
  }
  return {
    apps: [...apps]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    tags: [...tags].sort((a, b) => a.localeCompare(b)),
  };
}

export interface FolderNode {
  folder: Folder;
  depth: number;
}

/** Folders in display order (depth-first, alphabetical), with nesting depth. */
export function folderTree(folders: readonly Folder[]): FolderNode[] {
  const ids = new Set(folders.map((f) => f.id));
  const children = new Map<string | undefined, Folder[]>();
  for (const f of folders) {
    const parent = f.parentId && ids.has(f.parentId) ? f.parentId : undefined;
    children.set(parent, [...(children.get(parent) ?? []), f]);
  }
  const out: FolderNode[] = [];
  const walk = (parent: string | undefined, depth: number, seen: Set<string>) => {
    for (const f of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      if (seen.has(f.id)) continue; // ignore cycles from a damaged folders file
      seen.add(f.id);
      out.push({ folder: f, depth });
      walk(f.id, depth + 1, seen);
    }
  };
  walk(undefined, 0, new Set());
  return out;
}

/** Parse "a, b ,c" into unique trimmed tags. */
export function parseTags(input: string): string[] {
  return [
    ...new Set(
      input
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}
