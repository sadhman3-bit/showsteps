import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { InputModeSchema } from '@trailmark/core';
import { z } from 'zod';
import product from '../../../../product.json';

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

/**
 * Documents\<name>\Library. A library made under an earlier product name is kept where it is
 * (`pnpm rename` records old names in product.json).
 */
export function defaultLibraryPath(documents: string, exists = existsSync): string {
  for (const name of [...product.previous].reverse()) {
    const path = join(documents, name, 'Library');
    if (exists(path)) return path;
  }
  return join(documents, product.name, 'Library');
}

export function defaultSettings(documents: string): DesktopSettings {
  return {
    userName: userInfo().username || 'Me',
    guidanceEnabled: true,
    aiEnabled: false,
    libraryPath: defaultLibraryPath(documents),
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
