import { BRIDGE_HOST } from '@showsteps/core';
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import extensionKey from '../../../extension/extension-key.json';

const run = promisify(execFile);

/** Browsers that look for native messaging hosts under HKCU (per user, no admin rights). */
export const BROWSER_KEYS = [
  'Software\\Google\\Chrome\\NativeMessagingHosts',
  'Software\\Chromium\\NativeMessagingHosts',
  'Software\\Microsoft\\Edge\\NativeMessagingHosts',
];

/** The host's name before the product was called ShowSteps: registering removes its keys. */
export const LEGACY_BRIDGE_HOSTS = ['com.trailmark.host'];

export const EXTENSION_ID: string = extensionKey.id;
/**
 * The same extension installed from the Chrome Web Store has an ID Google assigns (set
 * `webstoreId` in extension-key.json once the item exists). Both may talk to the desktop app.
 */
export const EXTENSION_IDS: string[] = [EXTENSION_ID, extensionKey.webstoreId].filter(
  (id): id is string => /^[a-p]{32}$/.test(id ?? ''),
);

export function hostManifest(hostExe: string): object {
  return {
    name: BRIDGE_HOST,
    description: 'ShowSteps desktop app bridge',
    path: hostExe,
    type: 'stdio',
    allowed_origins: EXTENSION_IDS.map((id) => `chrome-extension://${id}/`),
  };
}

/**
 * Register the native messaging host for the current user (the installer does the same; this
 * keeps a moved or portable copy working). Writes the manifest next to the app's data.
 */
export async function registerNativeHost(dataDir: string, hostExe: string): Promise<string> {
  await mkdir(dataDir, { recursive: true });
  const manifest = join(dataDir, `${BRIDGE_HOST}.json`);
  await writeFile(manifest, `${JSON.stringify(hostManifest(hostExe), null, 2)}\n`);
  for (const key of BROWSER_KEYS) {
    await run(
      'reg',
      ['add', `HKCU\\${key}\\${BRIDGE_HOST}`, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f'],
      {
        windowsHide: true,
      },
    ).catch(() => undefined);
  }
  await removeKeys(LEGACY_BRIDGE_HOSTS);
  return manifest;
}

async function removeKeys(hosts: string[]): Promise<void> {
  for (const key of BROWSER_KEYS)
    for (const host of hosts)
      await run('reg', ['delete', `HKCU\\${key}\\${host}`, '/f'], {
        windowsHide: true,
      }).catch(() => undefined);
}

/** Remove the registration (the uninstaller runs this; it also deletes the keys itself). */
export async function unregisterNativeHost(dataDir: string): Promise<void> {
  await removeKeys([BRIDGE_HOST, ...LEGACY_BRIDGE_HOSTS]);
  await rm(join(dataDir, `${BRIDGE_HOST}.json`), { force: true });
}
