import { BRIDGE_HOST } from '@trailmark/core';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
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

export const EXTENSION_ID: string = extensionKey.id;

export function hostManifest(hostExe: string): object {
  return {
    name: BRIDGE_HOST,
    description: 'Trailmark desktop app bridge',
    path: hostExe,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
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
  return manifest;
}
