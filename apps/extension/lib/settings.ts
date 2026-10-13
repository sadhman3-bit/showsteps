// Settings and page marks (notes and pins), kept in extension storage on this computer.
import { parseMarks, type PageMark } from '@showsteps/core';
import {
  DEFAULT_SETTINGS,
  MARKS_KEY,
  SETTINGS_KEY,
  SettingsSchema,
  type Settings,
} from './guideMessages';

export async function readSettings(): Promise<Settings> {
  const r = await browser.storage.local.get(SETTINGS_KEY);
  const parsed = SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(r[SETTINGS_KEY] ?? {}) });
  return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
}

export async function writeSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: SettingsSchema.parse(settings) });
}

export async function readMarks(): Promise<PageMark[]> {
  const r = await browser.storage.local.get(MARKS_KEY);
  return parseMarks(r[MARKS_KEY]);
}

export async function writeMarks(marks: PageMark[]): Promise<void> {
  await browser.storage.local.set({ [MARKS_KEY]: marks });
}
