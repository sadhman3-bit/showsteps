import type { RunLog, Schedule } from '@showsteps/core';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { ConfirmDialog, Dialog } from '../components/Dialog.js';
import { Icon } from '../components/Icon.js';
import { strings } from '../strings.js';
import { relativeTime } from '../time.js';
import { describeSchedule, formatWhen } from './format.js';

const s = strings.schedules;

export interface ScheduleItem {
  schedule: Schedule;
  /** Undefined when the guide was deleted. */
  guideTitle?: string;
  next?: Date;
  /** Pre-approved steps were approved for an earlier version of the guide. */
  outdated: boolean;
  /** Newest first. */
  logs: RunLog[];
}

export interface SchedulesPageProps {
  /** Undefined while loading. */
  items: ScheduleItem[] | undefined;
  /** The schedule whose run is going now. */
  runningId?: string;
  /** A message after Run now (busy, started). */
  notice?: string;
  onBack: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onRunNow: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  loadShot: (name: string) => Promise<Blob | undefined>;
}

/** S3: every schedule with its next run, last outcome, controls and run history. */
export function SchedulesPage(props: SchedulesPageProps) {
  const [deleting, setDeleting] = useState<string>();
  const [enlarged, setEnlarged] = useState<{ name: string; number: number }>();
  return (
    <main class="ss-page ss-schedules" aria-busy={!props.items}>
      <nav class="ss-guide__nav">
        <Button variant="ghost" onClick={props.onBack}>
          <Icon name="back" /> {strings.guide.back}
        </Button>
      </nav>
      <h1>{s.title}</h1>
      <p class="ss-muted">{s.intro}</p>
      <p class="ss-callout">
        <Icon name="info" />
        <span>{s.limits}</span>
      </p>
      {props.notice ? (
        <p class="ss-notice" role="status">
          {props.notice}
        </p>
      ) : null}
      {props.items && !props.items.length ? <p class="ss-empty">{s.none}</p> : null}
      <ul class="ss-schedules__list">
        {props.items?.map((item) => (
          <ScheduleCard
            key={item.schedule.id}
            item={item}
            running={props.runningId === item.schedule.id}
            onToggle={(on) => props.onToggle(item.schedule.id, on)}
            onRunNow={() => props.onRunNow(item.schedule.id)}
            onEdit={() => props.onEdit(item.schedule.id)}
            onDelete={() => setDeleting(item.schedule.id)}
            loadShot={props.loadShot}
            onEnlarge={(name, number) => setEnlarged({ name, number })}
          />
        ))}
      </ul>
      {deleting ? (
        <ConfirmDialog
          title={s.deleteTitle}
          message={s.deleteBody}
          confirm={s.delete}
          onClose={() => setDeleting(undefined)}
          onConfirm={() => {
            props.onDelete(deleting);
            setDeleting(undefined);
          }}
        />
      ) : null}
      {enlarged ? (
        <Dialog title={s.pictureTitle(enlarged.number)} onClose={() => setEnlarged(undefined)}>
          <Shot
            name={enlarged.name}
            loadShot={props.loadShot}
            alt={s.pictureTitle(enlarged.number)}
            class="ss-schedules__full"
          />
        </Dialog>
      ) : null}
    </main>
  );
}

function ScheduleCard(props: {
  item: ScheduleItem;
  running: boolean;
  onToggle: (on: boolean) => void;
  onRunNow: () => void;
  onEdit: () => void;
  onDelete: () => void;
  loadShot: (name: string) => Promise<Blob | undefined>;
  onEnlarge: (name: string, number: number) => void;
}) {
  const { schedule, guideTitle, next, outdated, logs } = props.item;
  const [open, setOpen] = useState(false);
  // The switch moves at once; the saved value catches up when the background has saved it.
  const [enabled, setEnabled] = useState(schedule.enabled);
  useEffect(() => setEnabled(schedule.enabled), [schedule.enabled]);
  const name = guideTitle ?? s.guideMissing;
  const last = logs.find((l) => l.outcome);
  const headingId = `ss-sched-${schedule.id}`;
  return (
    <li class="ss-schedules__item" aria-labelledby={headingId}>
      <div class="ss-schedules__head">
        <div class="ss-schedules__what">
          <h2 id={headingId}>{name}</h2>
          <p>
            {describeSchedule(schedule)}
            {' · '}
            {enabled ? (next ? s.next(formatWhen(next)) : s.noNextRun) : s.off}
          </p>
          <p class="ss-muted">
            {props.running ? (
              <strong class="ss-schedules__running">{s.running}</strong>
            ) : last?.outcome ? (
              <span>
                <span class="ss-schedules__outcome" data-outcome={last.outcome}>
                  {s.outcomes[last.outcome]}
                </span>{' '}
                {relativeTime(last.finishedAt ?? last.startedAt)}
                {last.reason && s.reasons[last.reason] ? ` · ${s.reasons[last.reason]}` : ''}
              </span>
            ) : (
              s.notRun
            )}
          </p>
        </div>
        <input
          type="checkbox"
          role="switch"
          class="ss-toggle"
          aria-label={s.switchLabel(name)}
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.currentTarget.checked);
            props.onToggle(e.currentTarget.checked);
          }}
        />
      </div>
      {outdated ? (
        <p class="ss-callout ss-callout--warning">
          <Icon name="warning" />
          <span>{s.approvalsOutdated}</span>
        </p>
      ) : null}
      <div class="ss-schedules__actions">
        <Button
          variant="primary"
          size="sm"
          disabled={props.running || !guideTitle}
          onClick={props.onRunNow}
        >
          <Icon name="play" size={16} /> {s.runNow}
        </Button>
        <Button size="sm" disabled={!guideTitle} onClick={props.onEdit}>
          {s.edit}
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onDelete}>
          {s.delete}
        </Button>
      </div>
      <details
        class="ss-disclosure ss-schedules__history"
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>{s.history(logs.length)}</summary>
        {open ? (
          logs.length ? (
            <ol class="ss-runs">
              {logs.map((log) => (
                <RunRow
                  key={log.id}
                  log={log}
                  loadShot={props.loadShot}
                  onEnlarge={props.onEnlarge}
                />
              ))}
            </ol>
          ) : (
            <p class="ss-muted">{s.noHistory}</p>
          )
        ) : null}
      </details>
    </li>
  );
}

function RunRow(props: {
  log: RunLog;
  loadShot: (name: string) => Promise<Blob | undefined>;
  onEnlarge: (name: string, number: number) => void;
}) {
  const { log } = props;
  const values = Object.entries(log.values);
  const shots = log.steps.filter((st) => st.screenshot);
  return (
    <li class="ss-run">
      <p class="ss-run__head">
        <time dateTime={log.startedAt}>{formatWhen(log.startedAt)}</time>
        <span class="ss-schedules__outcome" data-outcome={log.outcome ?? 'running'}>
          {log.outcome ? s.outcomes[log.outcome] : s.running}
        </span>
        {log.reason && s.reasons[log.reason] ? (
          <span class="ss-muted">{s.reasons[log.reason]}</span>
        ) : null}
      </p>
      {values.length ? (
        <dl class="ss-run__values">
          <dt>{s.valuesUsed}</dt>
          {values.map(([key, value]) => (
            <dd key={key}>{value}</dd>
          ))}
        </dl>
      ) : null}
      {shots.length ? (
        <ul class="ss-run__shots">
          {shots.map((st) => (
            <li key={st.screenshot}>
              <button
                type="button"
                class="ss-run__shot"
                aria-label={s.pictureTitle(st.number)}
                onClick={() => props.onEnlarge(st.screenshot ?? '', st.number)}
              >
                <Shot name={st.screenshot ?? ''} loadShot={props.loadShot} alt="" />
                <span>{s.stepPicture(st.number)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** A run-log picture, loaded from the extension's storage when shown. */
function Shot(props: {
  name: string;
  alt: string;
  class?: string;
  loadShot: (name: string) => Promise<Blob | undefined>;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let live = true;
    let made: string | undefined;
    void props.loadShot(props.name).then((blob) => {
      if (!live || !blob) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [props.name]);
  return url ? (
    <img src={url} alt={props.alt} class={props.class} loading="lazy" decoding="async" />
  ) : (
    <span class={`ss-run__placeholder ${props.class ?? ''}`} aria-hidden="true" />
  );
}
