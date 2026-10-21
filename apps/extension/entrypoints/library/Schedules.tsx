import {
  approvalsOutdated,
  nextRun,
  type Guide,
  type GuideStore,
  type Schedule,
} from '@showsteps/core';
import { ScheduleDialog, SchedulesPage, strings, type ScheduleItem } from '@showsteps/ui';
import { useEffect, useState } from 'preact/hooks';
import {
  deleteSchedule,
  enableSchedule,
  getRunLogs,
  readSchedules,
  runLogsFor,
  runScheduleNow,
  saveSchedule,
  schedulesSeen,
  useSchedulesVersion,
} from '../../lib/scheduleClient';

const s = strings.schedules;

/** The Schedules page (S3), with data from this browser profile. */
export function Schedules(props: {
  store: GuideStore;
  refreshKey: number;
  runningId: string | undefined;
  onBack: () => void;
  onEdit: (schedule: Schedule) => void;
}) {
  const version = useSchedulesVersion();
  const [items, setItems] = useState<ScheduleItem[]>();
  const [notice, setNotice] = useState('');

  // Opening the page (or a run ending while it's open) clears the toolbar badge.
  useEffect(() => {
    if (document.visibilityState === 'visible') void schedulesSeen();
  }, [version]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const now = new Date();
      const out: ScheduleItem[] = [];
      for (const schedule of await readSchedules()) {
        const guide = await props.store.getGuide(schedule.guideId).catch(() => undefined);
        const next = nextRun(schedule, now);
        out.push({
          schedule,
          ...(guide ? { guideTitle: guide.title } : {}),
          ...(next ? { next } : {}),
          outdated: guide ? approvalsOutdated(schedule, guide) : false,
          logs: await runLogsFor(schedule.id),
        });
      }
      out.sort((a, b) => (a.next?.getTime() ?? Infinity) - (b.next?.getTime() ?? Infinity));
      if (live) setItems(out);
    })();
    return () => {
      live = false;
    };
  }, [props.store, props.refreshKey, version]);

  return (
    <SchedulesPage
      items={items}
      {...(props.runningId ? { runningId: props.runningId } : {})}
      notice={notice}
      onBack={props.onBack}
      onToggle={(id, on) => void enableSchedule(id, on)}
      onRunNow={(id) => {
        setNotice('');
        void runScheduleNow(id).then((error) => setNotice(error ? s.busy : s.started));
      }}
      onEdit={(id) => {
        const schedule = items?.find((i) => i.schedule.id === id)?.schedule;
        if (schedule) props.onEdit(schedule);
      }}
      onDelete={(id) => void deleteSchedule(id)}
      loadShot={(name) => getRunLogs().getShot(name)}
    />
  );
}

/** The Schedule dialog for a guide: saving asks for website access and notifications. */
export function ScheduleHost(props: {
  guide: Guide;
  schedule?: Schedule;
  desktopConnected: boolean;
  /** The desktop app is connected but doesn't start with Windows (S4). */
  suggestStartWithWindows: boolean;
  onDone: () => void;
}) {
  const [error, setError] = useState('');
  return (
    <ScheduleDialog
      guide={props.guide}
      {...(props.schedule ? { schedule: props.schedule } : {})}
      desktopConnected={props.desktopConnected}
      {...(props.suggestStartWithWindows
        ? { extra: <p class="ss-notice">{s.suggestStartWithWindows}</p> }
        : {})}
      {...(error ? { error } : {})}
      onClose={props.onDone}
      onSave={(schedule) => {
        // Inside the click: the permission prompt needs it.
        void saveSchedule(schedule).then((result) => {
          if (result === 'saved') props.onDone();
          else setError(result === 'permission' ? s.permission : strings.errors.generic);
        });
      }}
    />
  );
}
