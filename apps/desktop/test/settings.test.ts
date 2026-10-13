import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultLibraryPath, MOVED_NOTE, type MoveFs } from '../src/main/settings';

const docs = join('C:', 'Users', 'me', 'Documents');

/** An in-memory folder tree: a set of existing paths. */
function memoryFs(existing: string[], failRename = false) {
  const paths = new Set(existing);
  const notes = new Map<string, string>();
  const fs: MoveFs = {
    exists: (p) => paths.has(p),
    rename: (from, to) => {
      if (failRename) throw new Error('EBUSY');
      paths.delete(from);
      paths.add(to);
    },
    mkdir: (p) => void paths.add(p),
    write: (p, text) => void notes.set(p, text),
  };
  return { fs, paths, notes };
}

describe('default library folder', () => {
  it('is Documents/ShowSteps/Library', () => {
    expect(defaultLibraryPath(docs, memoryFs([]).fs)).toBe(join(docs, 'ShowSteps', 'Library'));
  });

  it('moves a library made under the old name and leaves a note', () => {
    const old = join(docs, 'Trailmark', 'Library');
    const m = memoryFs([join(docs, 'Trailmark'), old]);
    const path = defaultLibraryPath(docs, m.fs);
    expect(path).toBe(join(docs, 'ShowSteps', 'Library'));
    expect(m.paths.has(old)).toBe(false);
    expect(m.paths.has(path)).toBe(true);
    expect(m.notes.get(join(docs, 'Trailmark', MOVED_NOTE))).toContain(path);
  });

  it('keeps using the old library when it cannot be moved', () => {
    const old = join(docs, 'Trailmark', 'Library');
    expect(defaultLibraryPath(docs, memoryFs([old], true).fs)).toBe(old);
  });

  it('never moves anything once the ShowSteps library exists', () => {
    const now = join(docs, 'ShowSteps', 'Library');
    const old = join(docs, 'Trailmark', 'Library');
    const m = memoryFs([now, old]);
    expect(defaultLibraryPath(docs, m.fs)).toBe(now);
    expect(m.paths.has(old)).toBe(true);
  });
});
