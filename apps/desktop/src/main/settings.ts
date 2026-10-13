import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { InputModeSchema } from '@showsteps/core';
import { z } from 'zod';

export const DesktopSettingsSchema = z.object({
  userName: z.string().min(1).max(100),
  guidanceEnabled: z.boolean(),
  aiEnabled: z.boolean(),
  /** Personal library folder. */
  libraryPath: z.string().min(1),
  /** Team library: a synced folder (OneDrive, SharePoint) shared with others. Empty for none. */
  sharedPath: z.string(),
  /** Which library the window shows. */
  active: z.enum(['personal', 'shared']),
  /** How typed values in new guides are used (U4). */
  defaultInputMode: InputModeSchema,
  /** Colours of the app's windows. */
  theme: z.enum(['system', 'light', 'dark']),
});
export type DesktopSettings = z.infer<typeof DesktopSettingsSchema>;

/** Folder name under Documents. */
export const PRODUCT_FOLDER = 'ShowSteps';
/** Names the product had before ShowSteps; their Documents folders are moved on first run. */
export const FORMER_FOLDERS = ['Trailmark', 'ABCXYZ'];
export const MOVED_NOTE = 'MOVED_TO_SHOWSTEPS.txt';

export interface MoveFs {
  exists(path: string): boolean;
  rename(from: string, to: string): void;
  mkdir(path: string): void;
  write(path: string, text: string): void;
}
const realFs: MoveFs = {
  exists: existsSync,
  rename: renameSync,
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  write: (path, text) => writeFileSync(path, text),
};

/**
 * The personal library: Documents\ShowSteps\Library. On the first run under the new name, the
 * library in Documents\Trailmark (or Documents\ABCXYZ) is moved there, guides and all, and a note
 * in the old folder says where it went. Only the Library folder moves: anything else the owner
 * keeps in the old folder (an unpacked extension, say) stays put. If the move fails (a file is
 * open elsewhere), the old library keeps being used, so no guide ever goes missing.
 */
export function defaultLibraryPath(documents: string, fs: MoveFs = realFs): string {
  const target = join(documents, PRODUCT_FOLDER, 'Library');
  if (fs.exists(target)) return target;
  for (const name of FORMER_FOLDERS) {
    const old = join(documents, name, 'Library');
    if (!fs.exists(old)) continue;
    try {
      fs.mkdir(join(documents, PRODUCT_FOLDER));
      fs.rename(old, target);
    } catch {
      return old;
    }
    try {
      fs.write(
        join(documents, name, MOVED_NOTE),
        `${name} is now called ShowSteps. Your guides were moved to:\r\n${target}\r\n`,
      );
    } catch {
      // The note is a courtesy; the guides have moved either way.
    }
    break;
  }
  return target;
}

/** `libraryPath` overrides the default (tests use their own folder, so nothing is moved). */
export function defaultSettings(documents: string, libraryPath?: string): DesktopSettings {
  return {
    userName: userInfo().username || 'Me',
    guidanceEnabled: true,
    aiEnabled: false,
    libraryPath: libraryPath ?? defaultLibraryPath(documents),
    sharedPath: '',
    active: 'personal',
    defaultInputMode: 'fixed',
    theme: 'system',
  };
}

export async function loadSettings(
  file: string,
  defaults: DesktopSettings,
): Promise<DesktopSettings> {
  try {
    const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
    const parsed = DesktopSettingsSchema.safeParse({ ...defaults, ...(raw as object) });
    return parsed.success ? parsed.data : defaults;
  } catch {
    return defaults;
  }
}

export async function saveSettings(file: string, settings: DesktopSettings): Promise<void> {
  await writeFile(file, `${JSON.stringify(DesktopSettingsSchema.parse(settings), null, 2)}\n`);
}
