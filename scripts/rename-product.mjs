// Rename the product everywhere people see it: `pnpm rename "New Name"`.
// Replaces the current name (product.json) as a whole word in every tracked text file except
// the build history and the Windows helpers' C# namespaces. Lower-case identifiers stay as they
// are (`@trailmark/*` packages, the `.trailmark` file format, `com.trailmark.host`, storage
// names), so saved guides, settings and the desktop connection keep working.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const productFile = join(root, 'product.json');
const product = JSON.parse(readFileSync(productFile, 'utf8'));
const next = process.argv.slice(2).join(' ').trim();
if (!next || !/^[\p{L}\p{N}][\p{L}\p{N} .&'-]{0,40}$/u.test(next)) {
  console.error(
    'Usage: pnpm rename "New Name"  (letters, digits, spaces, . & \' -; up to 41 characters)',
  );
  process.exit(1);
}
const old = product.name;
if (next === old) process.exit(0);

/** Files that record how the product was built under earlier names; left as written. */
const KEEP = new Set([
  'BUILD_PROMPT.md',
  'PROGRESS.md',
  'PARITY.md',
  'docs/DEVELOPING.md',
  'docs/DECISIONS.md',
  'start-build.cmd',
  'product.json',
]);
const TEXT = /\.(ts|tsx|mjs|js|json|md|html|css|svg|nsh|yml|yaml|txt)$/;

const escaped = old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'gu');
const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && TEXT.test(f) && !KEEP.has(f) && !f.includes('/golden/'));
let changed = 0;
for (const file of files) {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  const out = text.replace(word, next);
  if (out !== text) {
    writeFileSync(path, out);
    changed++;
  }
}
product.name = next;
product.previous = [...new Set([...(product.previous ?? []), old])];
writeFileSync(productFile, `${JSON.stringify(product, null, 2)}\n`);
console.log(`Renamed ${old} → ${next} in ${changed} files.`);
console.log(
  'Next: pnpm build, then update golden files (pnpm --filter @trailmark/core exec vitest run -u),',
);
console.log('pnpm make:samples, pnpm store:images and node scripts/webstore-helper.mjs.');
