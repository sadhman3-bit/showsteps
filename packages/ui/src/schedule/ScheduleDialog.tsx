import {
  PLACEHOLDERS,
  ScheduleSchema,
  approvalsOutdated,
  createSchedule,
  guideSteps,
  needsPerson,
  nextRun,
  nextRuns,
  resolveTokens,
  runFields,
  toPlainText,
  unknownPlaceholders,
  withApprovals,
  type Guide,
  type Recurrence,
  type Schedule,
} from '@showsteps/core';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Button, IconButton } from '../Button.js';
import { Dialog } from '../components/Dialog.js';
import { Icon } from '../components/Icon.js';
import { strings } from '../strings.js';
import { formatWhen } from './format.js';

const s = strings.schedules;
const KINDS: Recurrence['kind'][] = [
  'daily',
  'weekdays',
  'weekly',
  'monthly-day',
  'monthly-business-day',
];
const DATE_FORMATS = ['dd/MM/yyyy', 'd/M/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'd MMMM yyyy'];
const WAITS = [10, 15, 30, 60, 120];
/** Monday first, as most calendars here show it. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export interface ScheduleDialogProps {
  guide: Guide;
  /** The schedule being edited; a new one otherwise. */
  schedule?: Schedule;
  /** The desktop app is connected (it can open Chrome for a run). */
  desktopConnected: boolean;
  /** Shown above the buttons, e.g. a suggestion from the host. */
  extra?: ComponentChildren;
  /** A message from the host after a failed save (website access refused). */
  error?: string;
  /** Called inside the Save click, so the host can ask for permissions. */
  onSave: (schedule: Schedule) => void;
  onClose: () => void;
  /** For tests: the time the "next runs" line counts from. */
  now?: Date;
}

/** Set when a guide's Run for me runs: repeat, values, approvals and what to do at a stop. */
export function ScheduleDialog(props: ScheduleDialogProps) {
  const { guide } = props;
  const fields = runFields(guide);
  const confirmSteps = guideSteps(guide)
    .map((step, i) => ({ step, number: i + 1 }))
    .filter(({ step }) => step.agent.confirm);
  const [draft, setDraft] = useState<Schedule>(
    () =>
      props.schedule ?? createSchedule(guide, { recurrence: { kind: 'weekdays' }, time: '09:00' }),
  );
  const [approved, setApproved] = useState<string[]>(() =>
    props.schedule && !approvalsOutdated(props.schedule, guide)
      ? props.schedule.approvedConfirmSteps.stepIds
      : [],
  );
  const [skip, setSkip] = useState('');
  const [problem, setProblem] = useState('');
  const set = (patch: Partial<Schedule>) => setDraft((d) => ({ ...d, ...patch }));
  const now = props.now ?? new Date();

  const upcoming = nextRuns({ ...draft, enabled: true }, now, 3);
  const previewAt = nextRun({ ...draft, enabled: true }, now) ?? now;

  const setKind = (kind: Recurrence['kind']) => {
    const recurrence: Recurrence =
      kind === 'weekly'
        ? { kind, days: [1] }
        : kind === 'monthly-day'
          ? { kind, day: 1 }
          : kind === 'monthly-business-day'
            ? { kind, nth: 1 }
            : { kind };
    set({ recurrence });
  };

  const save = () => {
    const parsed = ScheduleSchema.safeParse(withApprovals(draft, guide, approved));
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? strings.errors.generic);
      return;
    }
    setProblem('');
    props.onSave(parsed.data);
  };

  const r = draft.recurrence;
  const outdated = props.schedule ? approvalsOutdated(props.schedule, guide) : false;

  return (
    <Dialog
      title={s.dialogTitle(guide.title)}
      onClose={props.onClose}
      actions={
        <>
          <Button onClick={props.onClose}>{strings.library.cancel}</Button>
          <Button variant="primary" type="submit" form="ss-schedule">
            {s.save}
          </Button>
        </>
      }
    >
      <form
        id="ss-schedule"
        class="ss-stack-form ss-schedule"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {needsPerson(guide) ? (
          <p class="ss-callout">
            <Icon name="info" />
            <span>{s.desktopNote}</span>
          </p>
        ) : null}
        {!props.desktopConnected ? <p class="ss-muted">{s.chromeOnlyNote}</p> : null}

        <fieldset class="ss-fieldset">
          <legend>{s.when}</legend>
          <label class="ss-field">
            {s.repeat}
            <select
              class="ss-input"
              value={r.kind}
              onChange={(e) => setKind(e.currentTarget.value as Recurrence['kind'])}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {s.repeats[k]}
                </option>
              ))}
            </select>
          </label>
          {r.kind === 'weekly' ? (
            <fieldset class="ss-schedule__days">
              <legend>{s.days}</legend>
              {WEEK.map((day) => (
                <label key={day} class="ss-check">
                  <input
                    type="checkbox"
                    checked={r.days.includes(day)}
                    onChange={(e) => {
                      const days = e.currentTarget.checked
                        ? [...r.days, day]
                        : r.days.filter((d) => d !== day);
                      if (days.length) set({ recurrence: { kind: 'weekly', days: days.sort() } });
                    }}
                  />
                  <span aria-hidden="true">{s.dayShort[day]}</span>
                  <span class="ss-sr">{s.dayNames[day]}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {r.kind === 'monthly-day' ? (
            <label class="ss-field">
              {s.dayOfMonth}
              <input
                class="ss-input"
                type="number"
                min={1}
                max={31}
                value={r.day}
                onInput={(e) => {
                  const day = Math.min(31, Math.max(1, Number(e.currentTarget.value) || 1));
                  set({ recurrence: { kind: 'monthly-day', day } });
                }}
              />
              <small class="ss-muted">{s.dayOfMonthHint}</small>
            </label>
          ) : null}
          {r.kind === 'monthly-business-day' ? (
            <label class="ss-field">
              {s.businessDay}
              <select
                class="ss-input"
                value={String(r.nth)}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  set({
                    recurrence: {
                      kind: 'monthly-business-day',
                      nth: v === 'last' ? 'last' : (Number(v) as 1 | 2 | 3 | 4 | 5),
                    },
                  });
                }}
              >
                {['1', '2', '3', '4', '5', 'last'].map((v) => (
                  <option key={v} value={v}>
                    {s.nth[v]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label class="ss-field">
            {s.time}
            <input
              class="ss-input"
              type="time"
              required
              value={draft.time}
              onInput={(e) => e.currentTarget.value && set({ time: e.currentTarget.value })}
            />
          </label>
          <div class="ss-field">
            <span id="ss-skip-label">{s.skipDates}</span>
            <div class="ss-schedule__row">
              <input
                class="ss-input"
                type="date"
                aria-labelledby="ss-skip-label"
                value={skip}
                onInput={(e) => setSkip(e.currentTarget.value)}
              />
              <Button
                disabled={!skip || draft.skipDates.includes(skip)}
                onClick={() => {
                  set({ skipDates: [...draft.skipDates, skip].sort() });
                  setSkip('');
                }}
              >
                {s.skipAdd}
              </Button>
            </div>
            {draft.skipDates.length ? (
              <ul class="ss-schedule__skips">
                {draft.skipDates.map((d) => (
                  <li key={d}>
                    <span>{d}</span>
                    <IconButton
                      icon="x"
                      size="sm"
                      label={s.skipRemove(d)}
                      onClick={() => set({ skipDates: draft.skipDates.filter((x) => x !== d) })}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
            <small class="ss-muted">{s.skipHint}</small>
          </div>
          <p class="ss-schedule__next" aria-live="polite">
            <strong>{s.nextRuns}:</strong>{' '}
            {upcoming.length ? upcoming.map((d) => formatWhen(d)).join(' · ') : s.noNextRun}
          </p>
        </fieldset>

        {fields.length ? (
          <fieldset class="ss-fieldset">
            <legend>{s.values}</legend>
            <p class="ss-muted">{s.valuesHint}</p>
            {fields.map((f) => {
              const value = draft.values[f.key] ?? '';
              const unknown = unknownPlaceholders(value);
              let preview = '';
              if (!unknown.length)
                preview = resolveTokens(value, previewAt, draft.dateFormat, {
                  skipDates: draft.skipDates,
                });
              const id = `ss-value-${f.key}`;
              return (
                <div key={f.key} class="ss-field">
                  <label for={id}>{f.label}</label>
                  <div class="ss-schedule__row">
                    <input
                      id={id}
                      class="ss-input"
                      value={value}
                      aria-invalid={unknown.length > 0}
                      aria-describedby={`${id}-preview`}
                      onInput={(e) =>
                        set({ values: { ...draft.values, [f.key]: e.currentTarget.value } })
                      }
                    />
                    <select
                      class="ss-input ss-schedule__insert"
                      aria-label={`${s.insertDate}: ${f.label}`}
                      value=""
                      onChange={(e) => {
                        const p = e.currentTarget.value;
                        if (p) set({ values: { ...draft.values, [f.key]: `${value}{${p}}` } });
                      }}
                    >
                      <option value="">{s.insertDate}</option>
                      {PLACEHOLDERS.map((p) => (
                        <option key={p} value={p}>
                          {s.placeholders[p]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <small id={`${id}-preview`} class={unknown.length ? 'ss-error' : 'ss-muted'}>
                    {unknown.length
                      ? s.unknownPlaceholder(unknown[0] ?? '')
                      : preview
                        ? s.preview(preview)
                        : null}
                  </small>
                </div>
              );
            })}
            <label class="ss-field">
              {s.dateFormat}
              <select
                class="ss-input"
                value={draft.dateFormat}
                onChange={(e) => set({ dateFormat: e.currentTarget.value })}
              >
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        ) : null}

        <fieldset class="ss-fieldset">
          <legend>{s.approve}</legend>
          {outdated ? (
            <p class="ss-callout ss-callout--warning" role="alert">
              <Icon name="warning" />
              <span>{s.approvalsOutdated}</span>
            </p>
          ) : null}
          {confirmSteps.length ? (
            <>
              <p class="ss-muted">{s.approveHint}</p>
              {confirmSteps.map(({ step, number }) => (
                <label key={step.id} class="ss-check">
                  <input
                    type="checkbox"
                    checked={approved.includes(step.id)}
                    onChange={(e) =>
                      setApproved(
                        e.currentTarget.checked
                          ? [...approved, step.id]
                          : approved.filter((id) => id !== step.id),
                      )
                    }
                  />
                  {s.approveStep(number, toPlainText(step.human.title))}
                </label>
              ))}
            </>
          ) : (
            <p class="ss-muted">{s.noConfirmSteps}</p>
          )}
        </fieldset>

        <fieldset class="ss-fieldset">
          <legend>{s.missed}</legend>
          {(['run-at-start', 'skip'] as const).map((m) => (
            <label key={m} class="ss-check">
              <input
                type="radio"
                name="ss-missed"
                checked={draft.missedRun === m}
                onChange={() => set({ missedRun: m })}
              />
              {m === 'run-at-start' ? s.missedRun : s.missedSkip}
            </label>
          ))}
        </fieldset>

        <label class="ss-field">
          {s.wait}
          <select
            class="ss-input"
            value={String(draft.waitMinutes)}
            onChange={(e) => set({ waitMinutes: Number(e.currentTarget.value) })}
          >
            {WAITS.map((m) => (
              <option key={m} value={String(m)}>
                {s.waitFor(m)}
              </option>
            ))}
          </select>
        </label>
        <label class="ss-check">
          <input
            type="checkbox"
            checked={draft.keepWindowOpen}
            onChange={(e) => set({ keepWindowOpen: e.currentTarget.checked })}
          />
          {s.keepWindowOpen}
        </label>
        <label class="ss-check">
          <input
            type="checkbox"
            checked={draft.checkFirst}
            onChange={(e) => set({ checkFirst: e.currentTarget.checked })}
          />
          {s.checkFirst}
        </label>
        {props.extra}
        {problem || props.error ? (
          <p class="ss-error" role="alert">
            {problem || props.error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
