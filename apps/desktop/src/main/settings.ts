import { readFile, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { InputModeSchema } from '@trailmark/core';
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
});
export type DesktopSettings = z.infer<typeof DesktopSettingsSchema>;

export function defaultSettings(documents: string): DesktopSettings {
  return {
    userName: userInfo().username || 'Me',
    guidanceEnabled: true,
    aiEnabled: false,
    libraryPath: join(documents, 'Trailmark', 'Library'),
    sharedPath: '',
    active: 'personal',
    defaultInputMode: 'fixed',
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
