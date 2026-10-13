// Release files in dist/: the Chrome extension as a zip (install with "Load unpacked" after
// unzipping), the same extension packaged for the Chrome Web Store (manifest at the top, no
// `key`: the store assigns the ID), the Windows installer, and SHA-256 checksums. Run
// `pnpm release` (it builds everything first). Listing text and images: docs/webstore/.
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = JSON.parse(readFileSync(join(root, 'apps/extension/package.json'), 'utf8')).version;
const dist = join(root, 'dist');
const extension = join(root, 'apps/extension/.output/chrome-mv3');
const installer = join(root, 'apps/desktop/release', `ShowSteps-Setup-${version}.exe`);

for (const [path, what] of [
  [join(extension, 'manifest.json'), 'the extension build (pnpm build)'],
  [installer, 'the desktop installer (pnpm --filter @showsteps/desktop dist)'],
])
  if (!existsSync(path)) throw new Error(`Missing ${what}: ${path}`);

// The release build asks for no website access at install (only the e2e build does).
const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));
if (manifest.host_permissions?.length) throw new Error('Release manifest has host permissions');
if (manifest.version !== version)
  throw new Error(`Manifest version ${manifest.version} ≠ ${version}`);

// Empty dist/ rather than delete it: a shell or Explorer window may have it open.
mkdirSync(dist, { recursive: true });
for (const name of readdirSync(dist)) rmSync(join(dist, name), { recursive: true, force: true });

/** Every file under a folder, keyed by its path inside a top-level folder of the zip. */
function tree(dir, prefix) {
  const out = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[`${prefix}/${relative(dir, p).replaceAll('\\', '/')}`] = readFileSync(p);
    }
  };
  walk(dir);
  return out;
}

// Chrome Web Store upload: files at the top of the zip, and no `key` (the store refuses it).
const storeFiles = Object.fromEntries(
  Object.entries(tree(extension, '.')).map(([path, bytes]) => [path.slice(2), bytes]),
);
const { key: _key, ...storeManifest } = manifest;
storeFiles['manifest.json'] = new TextEncoder().encode(
  `${JSON.stringify(storeManifest, null, 2)}\n`,
);

const files = {
  [`showsteps-extension-${version}-chrome-web-store.zip`]: zipSync(storeFiles, {
    level: 9,
    mtime: new Date('2026-10-11T00:00:00Z'),
  }),
  [`showsteps-extension-${version}.zip`]: zipSync(
    tree(extension, `showsteps-extension-${version}`),
    {
      level: 9,
      mtime: new Date('2026-10-11T00:00:00Z'),
    },
  ),
};
for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dist, name), bytes);
copyFileSync(installer, join(dist, `ShowSteps-Setup-${version}.exe`));

const sums = readdirSync(dist)
  .sort()
  .map(
    (name) =>
      `${createHash('sha256')
        .update(readFileSync(join(dist, name)))
        .digest('hex')}  ${name}`,
  );
writeFileSync(join(dist, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
for (const name of readdirSync(dist))
  console.log(`${name.padEnd(36)} ${(statSync(join(dist, name)).size / 1e6).toFixed(1)} MB`);
