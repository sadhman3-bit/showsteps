// Schedules from extension pages: read directly (storage and IndexedDB), change through the
// background, which owns the alarms.
import { parseSchedules, type RunLog, type Schedule } from '@showsteps/core';
import { useEffect, useState } from 'preact/hooks';
import { GuideBroadcastSchema, type GuidePageMessage } from './guideMessages';
import { RunLogStore } from './runlogs';
import { SCHEDULES_KEY, SCHEDULE_STATE_KEY } from './schedules';

let logs: RunLogStore | undefined;

export function getRunLogs(): RunLogStore {
  logs ??= new RunLogStore(indexedDB);
  return logs;
}

/** Let go of the run-log database (before Delete all ShowSteps data removes it). */
export async function closeRunLogs(): Promise<void> {
  await logs?.close();
  logs = undefined;
}

export async function readSchedules(): Promise<Schedule[]> {
  return parseSchedules((await browser.storage.local.get(SCHEDULES_KEY))[SCHEDULES_KEY]);
}

export async function scheduleAttention(): Promise<boolean> {
  const st = (await browser.storage.local.get(SCHEDULE_STATE_KEY))[SCHEDULE_STATE_KEY] as
    { attention?: boolean } | undefined;
  return st?.attention === true;
}

export async function runLogsFor(scheduleId: string): Promise<RunLog[]> {
  return getRunLogs().list(scheduleId);
}

function send(msg: GuidePageMessage): Promise<Record<string, unknown> | undefined> {
  return browser.runtime.sendMessage(msg).catch(() => undefined) as Promise<
    Record<string, unknown> | undefined
  >;
}

/**
 * Save a schedule. Call inside the Save click: Chrome asks for website access (runs need it)
 * and for notifications in one prompt, and only from a click. Without website access the
 * schedule isn't saved; notifications are optional (the toolbar badge covers stops).
 */
export async function saveSchedule(schedule: Schedule): Promise<'saved' | 'permission' | 'error'> {
  const hasHosts = await browser.permissions
    .contains({ origins: ['<all_urls>'] })
    .catch(() => false);
  const granted = await browser.permissions
    .request({
      permissions: ['notifications'],
      ...(hasHosts ? {} : { origins: ['<all_urls>'] }),
    })
    .catch(() => false);
  if (!granted && !hasHosts) return 'permission';
  const r = await send({ type: 'schedule-save', schedule });
  return r && 'schedule' in r ? 'saved' : 'error';
}

export const deleteSchedule = (id: string) => send({ type: 'schedule-delete', id });
export const enableSchedule = (id: string, enabled: boolean) =>
  send({ type: 'schedule-enable', id, enabled });
export async function runScheduleNow(id: string): Promise<string | undefined> {
  const r = await send({ type: 'schedule-run', id });
  return typeof r?.error === 'string' ? r.error : undefined;
}
export const schedulesSeen = () => send({ type: 'schedule-seen' });

/** Bumped whenever schedules or their run logs change. */
export function useSchedulesVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const listener = (raw: unknown) => {
      const parsed = GuideBroadcastSchema.safeParse(raw);
      if (parsed.success && parsed.data.type === 'schedules-changed') setVersion((v) => v + 1);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);
  return version;
}
