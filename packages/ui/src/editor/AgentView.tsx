import {
  agentWarnings,
  stepNumbers,
  toPlainText,
  updateStep,
  type Expectation,
  type Guide,
  type Step,
  type Target,
} from '@showsteps/core';
import { useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { InputModeSelect } from '../components/InputModeSelect.js';
import { strings } from '../strings.js';
import { TextField } from './TextField.js';

const a = strings.agent;
const m = strings.inputMode;

function targetText(t: Partial<Target>): string {
  if (t.role && t.name) return `${t.role} “${t.name}”`;
  if (t.uia?.controlType && t.uia.name) return a.desktopTarget(t.uia.controlType, t.uia.name);
  return t.label ?? t.name ?? t.text ?? t.role ?? '';
}

export function expectationText(e: Expectation): string {
  const text = expectationWhat(e);
  return 'inFrame' in e && e.inFrame ? a.expectation.inFrame(text) : text;
}

function expectationWhat(e: Expectation): string {
  switch (e.type) {
    case 'url':
      return a.expectation.url(e.matches);
    case 'visible':
      return a.expectation.visible(targetText(e.target));
    case 'hidden':
      return a.expectation.hidden(targetText(e.target));
    case 'text':
      return a.expectation.text(e.contains);
    case 'window':
      return a.expectation.window(e.titleContains);
  }
}

type Apply = (edit: (latest: Guide) => Guide, how?: 'push' | 'type') => void;

/** One step's result from the self-check (U7), from the host. */
export interface StepCheckView {
  stepId: string;
  status: 'found' | 'ambiguous' | 'missing' | 'skipped';
  strategy?: string;
  reason?: string;
}

/**
 * U1: per step, what an agent reads (how to find the element, the value, the expected result,
 * what happens on failure, whether a person confirms first) and what needs attention.
 */
export function AgentView(props: {
  guide: Guide;
  apply: Apply;
  onEndTyping: () => void;
  /** U7: dry-run the guide (the extension); hidden when the host cannot. */
  onSelfCheck?: () => Promise<StepCheckView[] | undefined>;
}) {
  const { guide } = props;
  const [checks, setChecks] = useState<Map<string, StepCheckView>>();
  const [checking, setChecking] = useState<'idle' | 'running' | 'failed'>('idle');
  const runCheck = async () => {
    if (!props.onSelfCheck) return;
    setChecking('running');
    const result = await props.onSelfCheck().catch(() => undefined);
    if (!result) {
      setChecking('failed');
      return;
    }
    setChecks(new Map(result.map((c) => [c.stepId, c])));
    setChecking('idle');
  };
  const count = (status: StepCheckView['status']) =>
    [...(checks?.values() ?? [])].filter((c) => c.status === status).length;
  const warnings = agentWarnings(guide);
  const numbers = stepNumbers(guide);
  const editStep = (id: string, change: (s: Step) => Step, how: 'push' | 'type' = 'push') =>
    props.apply((g) => updateStep(g, id, change), how);
  return (
    <div class="ss-page ss-agent">
      <h2>{a.title}</h2>
      <p class="ss-muted">{a.intro}</p>
      <label class="ss-field ss-agent__mode">
        {a.defaultMode}
        <InputModeSelect
          value={guide.settings.defaultInputMode}
          onChange={(mode) =>
            props.apply((g) => ({ ...g, settings: { ...g.settings, defaultInputMode: mode } }))
          }
        />
      </label>
      {props.onSelfCheck ? (
        <section class="ss-agent__check" aria-label={a.selfCheck}>
          <Button
            onClick={() => void runCheck()}
            disabled={checking === 'running'}
            title={a.selfCheckHint}
          >
            {a.selfCheck}
          </Button>{' '}
          <span class="ss-muted" role="status">
            {checking === 'running'
              ? a.checking
              : checking === 'failed'
                ? a.checkFailed
                : checks
                  ? a.checkSummary(
                      count('found'),
                      count('ambiguous'),
                      count('missing'),
                      count('skipped'),
                    )
                  : a.selfCheckHint}
          </span>
        </section>
      ) : null}
      <section class="ss-agent__warnings" aria-label={a.warningsTitle(warnings.length)}>
        {warnings.length ? (
          <>
            <h3>{a.warningsTitle(warnings.length)}</h3>
            <ul>
              {warnings.map((w) => (
                <li key={`${w.stepId}-${w.kind}`}>
                  <a href={`#agent-${w.stepId}`}>{a.warnings[w.kind]?.(w.number)}</a>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p role="status">{a.noWarnings}</p>
        )}
      </section>
      <ol class="ss-agent__steps">
        {guide.blocks.map((b) =>
          b.kind === 'step' ? (
            <AgentStep
              key={b.id}
              step={b}
              number={numbers.get(b.id) ?? 0}
              warnings={warnings.filter((w) => w.stepId === b.id).map((w) => w.kind)}
              {...(checks?.get(b.id) ? { check: checks.get(b.id) } : {})}
              edit={(change, how) => editStep(b.id, change, how)}
              onEndTyping={props.onEndTyping}
            />
          ) : null,
        )}
      </ol>
    </div>
  );
}

function AgentStep(props: {
  step: Step;
  number: number;
  warnings: string[];
  check?: StepCheckView | undefined;
  edit: (change: (s: Step) => Step, how?: 'push' | 'type') => void;
  onEndTyping: () => void;
}) {
  const { step: s, number: n } = props;
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const t = s.target;
  const expect = s.agent.expect ?? [];
  const setExpect = (next: Expectation[]) =>
    props.edit((x) => {
      const agent = { ...x.agent };
      if (next.length) agent.expect = next;
      else delete agent.expect;
      return { ...x, agent };
    });
  const title = toPlainText(s.human.title);
  return (
    <li class="ss-agent__step" id={`agent-${s.id}`} aria-label={`${a.step(n)}: ${title}`}>
      <h3>
        <span class="ss-step__num">{n}</span> {title}
        {s.agent.confirm ? <span class="ss-badge">{a.confirmShort}</span> : null}
      </h3>
      {props.check ? (
        <p class={`ss-agent__result is-${props.check.status}`}>
          <strong>{a.checkStatus[props.check.status]}</strong>
          {props.check.strategy ? ` ${a.checkHow(props.check.strategy)}` : ''}
          {props.check.reason
            ? ` (${a.checkReason[props.check.reason] ?? props.check.reason})`
            : ''}
        </p>
      ) : null}
      {props.warnings.map((w) => (
        <p key={w} class="ss-agent__warning" role="note">
          {a.warnings[w]?.(n)}
        </p>
      ))}
      <dl class="ss-agent__facts">
        <dt>{a.target}</dt>
        <dd>
          {t ? (
            <>
              <strong>{targetText(t) || '—'}</strong>
              {t.frames?.length ? (
                <span class="ss-muted"> · iframe {t.frames.join(' → ')}</span>
              ) : null}
              {t.shadowHosts?.length ? (
                <span class="ss-muted"> · shadow {t.shadowHosts.join(' → ')}</span>
              ) : null}
              {t.selectors.length ? (
                <details>
                  <summary>{a.strategies}</summary>
                  <ul class="ss-agent__selectors">
                    {[...t.selectors]
                      .sort((x, y) => y.score - x.score)
                      .map((sel) => (
                        <li key={`${sel.type}:${sel.value}`}>
                          <code>{sel.type}</code> <code>{sel.value}</code>{' '}
                          <span class="ss-muted">{Math.round(sel.score * 100)}%</span>
                        </li>
                      ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <span class="ss-muted">{a.noTarget}</span>
          )}
        </dd>
        {s.input ? (
          <>
            <dt>{a.input}</dt>
            <dd>
              {s.input.sensitive
                ? m.secret
                : s.input.variable
                  ? `${m.variable(s.input.variable)} · ${m[s.input.mode]}`
                  : `“${s.input.value ?? ''}” · ${m.fixed}`}
            </dd>
          </>
        ) : null}
        <dt>{a.expect}</dt>
        <dd>
          {expect.length ? (
            <ul class="ss-agent__expect">
              {expect.map((e, i) => (
                <li key={`${i}-${JSON.stringify(e)}`}>
                  {expectationText(e)}{' '}
                  <Button
                    variant="ghost"
                    aria-label={a.removeExpect(expectationText(e))}
                    onClick={() => setExpect(expect.filter((_, k) => k !== i))}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <span class="ss-muted">{a.noExpect}</span>
          )}
          {adding ? (
            <form
              class="ss-row"
              onSubmit={(ev) => {
                ev.preventDefault();
                const contains = text.trim();
                if (contains) setExpect([...expect, { type: 'text', contains }]);
                setText('');
                setAdding(false);
              }}
            >
              <input
                class="ss-input"
                aria-label={a.addTextPrompt}
                value={text}
                onInput={(ev) => setText(ev.currentTarget.value)}
              />
              <Button type="submit">{a.addText}</Button>
            </form>
          ) : (
            <Button variant="ghost" onClick={() => setAdding(true)}>
              {a.addText}
            </Button>
          )}
        </dd>
        <dt>{a.onFailure}</dt>
        <dd>
          <TextField
            class="ss-input"
            aria-label={`${a.onFailure}: ${a.step(n)}`}
            placeholder={a.onFailurePlaceholder}
            value={s.agent.onFailure ?? ''}
            onValue={(v) =>
              props.edit((x) => {
                const agent = { ...x.agent };
                if (v) agent.onFailure = v;
                else delete agent.onFailure;
                return { ...x, agent };
              }, 'type')
            }
            onDone={props.onEndTyping}
          />
        </dd>
        <dt>{a.timeout}</dt>
        <dd>
          <input
            class="ss-input ss-agent__timeout"
            type="number"
            min={1}
            max={300}
            aria-label={`${a.timeout}: ${a.step(n)}`}
            value={Math.round(s.agent.timeoutMs / 1000)}
            onChange={(ev) => {
              const seconds = Math.min(300, Math.max(1, Number(ev.currentTarget.value) || 10));
              props.edit((x) => ({ ...x, agent: { ...x.agent, timeoutMs: seconds * 1000 } }));
            }}
          />
        </dd>
      </dl>
      <label class="ss-check">
        <input
          type="checkbox"
          checked={s.agent.confirm}
          onChange={(ev) => {
            const confirm = ev.currentTarget.checked;
            props.edit((x) => ({ ...x, agent: { ...x.agent, confirm } }));
          }}
        />{' '}
        {a.confirm}
      </label>
    </li>
  );
}
