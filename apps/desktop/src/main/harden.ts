// H7: the desktop app's own safety rules, kept apart from index.ts so they can be tested without
// Electron: windows never navigate away from the app, websites get no permissions, exports never
// overwrite a file, and the bridge's pipe name is the Windows account's SID.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';

/** The parts of a BrowserWindow that hardening touches. */
export interface Hardenable {
  webContents: {
    on(event: 'will-navigate', listener: (e: { preventDefault(): void }) => void): unknown;
  };
}

/** A window shows only the app: any navigation (a link, a drop, a page script) is refused. */
export function hardenWindow<W extends Hardenable>(win: W): W {
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  return win;
}

/** The part of an Electron session that hands out permissions. */
export interface PermissionSession {
  setPermissionRequestHandler(
    handler: (wc: unknown, permission: string, callback: (granted: boolean) => void) => void,
  ): void;
}

/** No camera, microphone, notifications, location or anything else for page content. */
export function denyPermissions(session: PermissionSession): void {
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}

/** `report.pdf`, or `report (2).pdf`, `report (3).pdf`… whichever doesn't exist yet in `dir`. */
export function freeName(
  dir: string,
  name: string,
  exists: (path: string) => boolean = existsSync,
): string {
  if (!exists(join(dir, name))) return name;
  const ext = extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!exists(join(dir, candidate))) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

/** The SID of the Windows account running this process (`S-1-5-21-…`), or undefined. */
export function currentSid(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    // By full path: another whoami (Git's, say) can come first in PATH.
    const whoami = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe');
    const out = execFileSync(whoami, ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return /"(S-1-[0-9-]+)"/.exec(out)?.[1];
  } catch {
    return undefined;
  }
}
