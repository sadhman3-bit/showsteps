import { IconButton } from '../Button.js';
import { stepNumbers, toPlainText, type Guide, type GuideStore, type Step } from '@showsteps/core';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { brandStyle } from '../brand.js';
import { brandFor, kitAsset, useBrandSources } from '../brand/sources.js';
import { Icon, type IconName } from '../components/Icon.js';
import { RichText } from '../components/RichText.js';
import { useImageUrl } from '../hooks.js';
import { strings } from '../strings.js';
import { relativeTime } from '../time.js';
import { Screenshot } from './Screenshot.js';

const s = strings.guide;

export interface GuideReaderProps {
  store: GuideStore;
  guide: Guide;
  /** Scroll to and highlight this step. */
  focusStepId?: string;
  /** Offer "copy link to this step" (the host knows the link format). */
  onCopyLink?: (stepId: string) => void;
  copiedStepId?: string;
  /** Extra content under a block (comments and reactions). */
  renderAfter?: (blockId: string) => ComponentChildren;
  /** Content after the last block. */
  footer?: ComponentChildren;
}

/** A guide exactly as readers see it, with branding applied. */
export function GuideReader({
  store,
  guide,
  focusStepId,
  onCopyLink,
  copiedStepId,
  renderAfter,
  footer,
}: GuideReaderProps) {
  const numbers = stepNumbers(guide);
  const guideLogo = useImageUrl(store, guide.id, guide.branding?.logo?.replace(/^img\//, ''));
  const root = useRef<HTMLElement>(null);
  // B6: the guide's brand (its kit, or the library's), as exports show it.
  const getSources = useBrandSources();
  const [brand, setBrand] = useState<{ accent: string; font?: string; logo?: string }>();
  useEffect(() => {
    let live = true;
    let url: string | undefined;
    void getSources().then(async (sources) => {
      const b = await brandFor(sources, guide);
      const from = b.logoFrom;
      const bytes = from?.from === 'kit' ? await kitAsset(sources, b.id, from.name) : undefined;
      if (bytes) url = URL.createObjectURL(new Blob([bytes as BlobPart]));
      if (live)
        setBrand({
          accent: b.colors.accent,
          ...(b.fonts.body ? { font: b.fonts.body } : {}),
          ...(url ? { logo: url } : {}),
        });
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [guide.branding]);
  const logo = guideLogo ?? brand?.logo;

  useEffect(() => {
    if (!focusStepId) return;
    const el = root.current?.querySelector(`#step-${CSS.escape(focusStepId)}`);
    el?.scrollIntoView({ block: 'start' });
  }, [focusStepId, guide]);

  return (
    <article
      class="ss-reader"
      style={brandStyle(brand ? { ...guide.branding, ...brand } : guide.branding)}
      ref={root}
    >
      <header class="ss-guide__header">
        {logo ? <img class="ss-reader__logo" src={logo} alt="" /> : null}
        <h1>{guide.title}</h1>
        {guide.description ? <p class="ss-guide__desc">{guide.description}</p> : null}
        <p class="ss-muted">
          {strings.library.steps(numbers.size)} ·{' '}
          {guide.updatedBy
            ? strings.library.editedBy(guide.updatedBy, relativeTime(guide.updatedAt))
            : strings.library.edited(relativeTime(guide.updatedAt))}
        </p>
      </header>
      {guide.blocks.length === 0 ? <p class="ss-empty">{s.noSteps}</p> : null}
      <ol class="ss-blocks">
        {guide.blocks.map((b) => {
          if (b.kind === 'heading') {
            return (
              <li key={b.id} class="ss-block ss-block--heading" id={`block-${b.id}`}>
                <h2>{b.text}</h2>
              </li>
            );
          }
          if (b.kind === 'callout') {
            return (
              <li
                key={b.id}
                class={`ss-block ss-callout ss-callout--${b.tone}`}
                id={`block-${b.id}`}
              >
                <Icon name={CALLOUT_ICON[b.tone]} size={20} />
                <div>
                  <strong class="ss-callout__title">{s.tone[b.tone]}</strong> {b.text}
                </div>
              </li>
            );
          }
          return (
            <ReaderStep
              key={b.id}
              store={store}
              guideId={guide.id}
              step={b}
              num={numbers.get(b.id) ?? 0}
              focused={b.id === focusStepId}
              {...(onCopyLink ? { onCopyLink: () => onCopyLink(b.id) } : {})}
              copied={copiedStepId === b.id}
              after={renderAfter?.(b.id)}
            />
          );
        })}
      </ol>
      {footer}
    </article>
  );
}

/** The icon shown in each kind of callout. */
export const CALLOUT_ICON: Record<'tip' | 'note' | 'warning' | 'alert', IconName> = {
  tip: 'tip',
  note: 'info',
  warning: 'warning',
  alert: 'alert',
};

function ReaderStep(props: {
  store: GuideStore;
  guideId: string;
  step: Step;
  num: number;
  focused: boolean;
  onCopyLink?: () => void;
  copied: boolean;
  after?: ComponentChildren;
}) {
  const { step, num } = props;
  const title = toPlainText(step.human.title);
  return (
    <li
      class={`ss-block ss-step${props.focused ? ' ss-step--focused' : ''}`}
      id={`step-${step.id}`}
    >
      <div class="ss-step__head">
        <span class="ss-step__num" aria-label={s.stepLabel(num)}>
          {num}
        </span>
        <h3 class="ss-step__title">
          <RichText value={step.human.title} />
        </h3>
        {props.onCopyLink ? (
          <IconButton
            icon={props.copied ? 'check' : 'copy-link'}
            size="sm"
            class={`ss-step__link${props.copied ? ' is-copied' : ''}`}
            label={props.copied ? strings.editor.linkCopied : strings.editor.copyLink}
            onClick={props.onCopyLink}
          />
        ) : null}
      </div>
      {step.human.description ? (
        <p class="ss-step__desc">
          <RichText value={step.human.description} />
        </p>
      ) : null}
      <Screenshot
        store={props.store}
        guideId={props.guideId}
        step={step}
        alt={step.human.altText ?? s.screenshotAlt(num, title)}
      />
      {props.after}
    </li>
  );
}
