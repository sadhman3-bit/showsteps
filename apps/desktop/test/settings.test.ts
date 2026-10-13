import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import product from '../../../product.json';
import { defaultLibraryPath } from '../src/main/settings';

describe('default library folder', () => {
  const docs = join('C:', 'Users', 'me', 'Documents');

  it('is Documents/<product name>/Library', () => {
    expect(defaultLibraryPath(docs, () => false)).toBe(join(docs, product.name, 'Library'));
  });

  it('keeps a library made under an earlier name', () => {
    const old = product.previous.at(-1);
    if (!old) return; // never renamed
    const path = join(docs, old, 'Library');
    expect(defaultLibraryPath(docs, (p) => p === path)).toBe(path);
  });
});
