import {
  attachSourceValid,
  guideSteps,
  setAttachSource,
  stepNumbers,
  suggestAttachSource,
  toPlainText,
  type Guide,
  type Step,
} from '@showsteps/core';
import { Button } from '../Button.js';
import { Icon } from '../components/Icon.js';
import { strings } from '../strings.js';

const f = strings.fileSource;
const MISSING = '__missing';

/** Chrome's optional download permission, as the host provides it (1.2). */
export interface DownloadAccess {
  has: () => Promise<boolean>;
  /** Ask for it. Call it straight from the click: the browser's prompt needs a user action. */
  request: () => Promise<boolean>;
}

/** What the editor knows about download access; undefined in the desktop app. */
export interface DownloadAccessView {
  state: 'granted' | 'missing' | 'declined';
  onAllow: () => void;
}

const short = (text: string) => (text.length > 60 ? `${text.slice(0, 59)}…` : text);

/** An upload step's "File" control: choose it yourself, or a file this run downloaded. */
export function FileControls(props: {
  guide: Guide;
  step: Step;
  num: number;
  access: DownloadAccessView | undefined;
  onGuide: (edit: (latest: Guide) => Guide) => void;
}) {
  const { guide, step: s } = props;
  const from = s.input?.from;
  const broken = !!from && !attachSourceValid(guide, s);
  const numbers = stepNumbers(guide);
  const steps = guideSteps(guide);
  const earlier = steps.slice(
    0,
    steps.findIndex((x) => x.id === s.id),
  );
  const value = !from ? '' : broken ? MISSING : from.download;
  const suggestion = suggestAttachSource(guide, s);
  const set = (download: string | undefined) =>
    props.onGuide((g) => setAttachSource(g, s.id, download ? { download } : undefined));
  return (
    <div class="ss-eblock__input ss-eblock__file">
      <div class="ss-row">
        <label class="ss-row">
          <span class="ss-muted">{f.label}</span>
          <select
            class="ss-input"
            aria-label={`${f.label}: ${strings.editor.stepTitle(props.num)}`}
            value={value}
            onChange={(ev) => set(ev.currentTarget.value || undefined)}
          >
            <option value="">{f.choose}</option>
            <option value="latest">{f.latest}</option>
            {earlier.map((x) => (
              <option key={x.id} value={x.id}>
                {f.fromStep(numbers.get(x.id) ?? 0, short(toPlainText(x.human.title)))}
              </option>
            ))}
            {broken ? (
              <option value={MISSING} disabled>
                {f.choose}
              </option>
            ) : null}
          </select>
        </label>
        {suggestion ? (
          <span class="ss-eblock__suggest">
            {f.suggest}{' '}
            <Button variant="ghost" onClick={() => set(suggestion.id)}>
              {f.suggestApply}
            </Button>
          </span>
        ) : null}
      </div>
      {broken ? (
        <p class="ss-callout ss-callout--warning" role="alert">
          <Icon name="warning" />
          <span>{f.broken}</span>
        </p>
      ) : from ? (
        <>
          <p class="ss-muted">{f.attaches}</p>
          {!props.access ? (
            <p class="ss-muted">{f.inChrome}</p>
          ) : props.access.state === 'granted' ? null : (
            <div class="ss-notice ss-eblock__access">
              <p>{props.access.state === 'declined' ? f.declined : f.access}</p>
              <Button size="sm" onClick={props.access.onAllow}>
                {f.allow}
              </Button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
