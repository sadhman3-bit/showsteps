// Writes licenses/NOTICES.txt into the extension and the desktop app: ShowSteps's own licence,
// the fonts' SIL Open Font License, and the licence (and NOTICE file, where there is one) of
// every package that ships inside them. Run: pnpm notices (after pnpm install).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const list = JSON.parse(
  execFileSync(pnpm, ['licenses', 'list', '--prod', '--json'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  }),
);

/** Type packages are never shipped. */
const skip = (name) => name.startsWith('@types/') || name === 'undici-types';

const fileLike = (dir, re) => {
  try {
    return readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => readFileSync(join(dir, f), 'utf8').trim());
  } catch {
    return [];
  }
};

const MIT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

/** The package ships no licence file: the standard text of its declared licence. */
function standardText(p, dir) {
  let author = '';
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    author = typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name ?? '');
  } catch {
    // no package.json details
  }
  const holder = author || `the ${p.name} authors`;
  if (/^MIT$/.test(p.license)) return MIT(holder);
  return `Copyright (c) ${holder}. Licensed under ${p.license}: https://spdx.org/licenses/${p.license.replace(/[()]/g, '').split(' ')[0]}.html`;
}

const sections = [];
const rule = '='.repeat(78);
const add = (title, body) => sections.push(`${rule}\n${title}\n${rule}\n\n${body.trim()}\n`);

add(
  'ShowSteps (PolyForm Noncommercial License 1.0.0)',
  readFileSync(join(root, 'LICENSE'), 'utf8'),
);
for (const f of readdirSync(join(root, 'packages/ui/assets/fonts')).filter((f) =>
  f.endsWith('.txt'),
))
  add(
    `${f.replace(/^OFL-|\.txt$/g, '')} font (SIL Open Font License 1.1)`,
    readFileSync(join(root, 'packages/ui/assets/fonts', f), 'utf8'),
  );

const packages = Object.entries(list)
  .flatMap(([license, pkgs]) => pkgs.map((p) => ({ ...p, license })))
  .filter((p) => !skip(p.name))
  .sort((a, b) => a.name.localeCompare(b.name));
const seen = new Set();
for (const p of packages) {
  if (seen.has(p.name)) continue;
  seen.add(p.name);
  const dir = (p.paths ?? [p.path]).find((d) => d && existsSync(d));
  const texts = dir ? fileLike(dir, /^(licen[cs]e|copying)(\.|$)/i) : [];
  const notices = dir ? fileLike(dir, /^notice(\.|$)/i) : [];
  const header = `${p.name}${p.versions?.length ? ` ${p.versions.join(', ')}` : ''} (${p.license})${p.homepage ? `\n${p.homepage}` : ''}`;
  add(header, [...texts, ...notices].join('\n\n') || standardText(p, dir));
}

const text = `Third-party notices for ShowSteps\n\nShowSteps includes the software and fonts listed below. Each is used under its own licence, reproduced here.\n\n${sections.join('\n')}`;
for (const dir of ['apps/extension/public/licenses', 'apps/desktop/src/renderer/public/licenses'])
  writeFileSync(join(root, dir, 'NOTICES.txt'), text);
console.log(`NOTICES.txt: ${seen.size} packages, ${(text.length / 1024).toFixed(0)} KB`);
