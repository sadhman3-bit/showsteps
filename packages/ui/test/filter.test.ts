import type { GuideSummary } from '@showsteps/core';
import { describe, expect, it } from 'vitest';
import {
  facets,
  filterGuides,
  folderTree,
  matchesText,
  parseTags,
  type LibraryQuery,
} from '../src/library/filter.js';
import { relativeTime } from '../src/time.js';

const g = (over: Partial<GuideSummary>): GuideSummary => ({
  id: over.id ?? 'x',
  title: 'Untitled',
  tags: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  stepCount: 1,
  apps: [],
  searchText: '',
  ...over,
});

const guides = [
  g({
    id: 'a',
    title: 'Create an invoice',
    updatedAt: '2026-10-02T00:00:00Z',
    stepCount: 20,
    tags: ['ap'],
    apps: [{ kind: 'web', origin: 'http://localhost:5173' }],
    searchText: 'Click Submit invoice',
    folderId: 'f1',
  }),
  g({
    id: 'b',
    title: 'Approve a payment',
    updatedAt: '2026-10-05T00:00:00Z',
    stepCount: 5,
    tags: ['ap', 'approvals'],
    apps: [{ kind: 'desktop', processName: 'EXCEL.EXE' }],
  }),
  g({ id: 'c', title: 'Résumé upload', createdAt: '2026-12-01T00:00:00Z', stepCount: 2 }),
  g({ id: 'd', title: 'Old one', trashedAt: '2026-10-07T00:00:00Z' }),
];
const q = (over: Partial<LibraryQuery>): LibraryQuery => ({
  scope: { kind: 'all' },
  text: '',
  sort: 'updated',
  ...over,
});
const ids = (list: GuideSummary[]) => list.map((x) => x.id);

describe('library filtering', () => {
  it('sorts live guides and keeps trashed ones apart', () => {
    expect(ids(filterGuides(guides, q({})))).toEqual(['b', 'a', 'c']);
    expect(ids(filterGuides(guides, q({ sort: 'title' })))).toEqual(['b', 'a', 'c']);
    expect(ids(filterGuides(guides, q({ sort: 'steps' })))).toEqual(['a', 'b', 'c']);
    expect(ids(filterGuides(guides, q({ sort: 'created' })))).toEqual(['c', 'a', 'b']);
    expect(ids(filterGuides(guides, q({ scope: { kind: 'trash' } })))).toEqual(['d']);
  });

  it('searches titles, tags and step text, ignoring case and accents', () => {
    expect(ids(filterGuides(guides, q({ text: 'submit INVOICE' })))).toEqual(['a']);
    expect(ids(filterGuides(guides, q({ text: 'approvals' })))).toEqual(['b']);
    expect(ids(filterGuides(guides, q({ text: 'resume' })))).toEqual(['c']);
    expect(matchesText(guides[0]!, 'invoice nothing')).toBe(false);
  });

  it('filters by folder, app and tag', () => {
    expect(ids(filterGuides(guides, q({ scope: { kind: 'folder', folderId: 'f1' } })))).toEqual([
      'a',
    ]);
    expect(ids(filterGuides(guides, q({ app: 'desktop:excel.exe' })))).toEqual(['b']);
    expect(ids(filterGuides(guides, q({ tag: 'ap' })))).toEqual(['b', 'a']);
  });

  it('lists facets from live guides only', () => {
    expect(facets(guides)).toEqual({
      apps: [
        { key: 'desktop:excel.exe', label: 'EXCEL' },
        { key: 'http://localhost:5173', label: 'localhost:5173' },
      ],
      tags: ['ap', 'approvals'],
    });
  });

  it('builds a nested folder tree and survives cycles', () => {
    const tree = folderTree([
      { id: 'b', name: 'Beta' },
      { id: 'a', name: 'Alpha' },
      { id: 'a1', name: 'Inner', parentId: 'a' },
      { id: 'x', name: 'Cycle', parentId: 'y' },
      { id: 'y', name: 'Loop', parentId: 'x' },
    ]);
    expect(tree.map((n) => `${'-'.repeat(n.depth)}${n.folder.name}`)).toEqual([
      'Alpha',
      '-Inner',
      'Beta',
    ]);
  });

  it('parses tags', () => {
    expect(parseTags(' ap, approvals ,, ap ')).toEqual(['ap', 'approvals']);
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-10-09T12:00:00Z');
    expect(relativeTime('2026-10-09T11:59:50Z', now, 'en')).toBe('just now');
    expect(relativeTime('2026-10-09T09:00:00Z', now, 'en')).toBe('3 hours ago');
    expect(relativeTime('2026-10-08T12:00:00Z', now, 'en')).toBe('yesterday');
  });
});
