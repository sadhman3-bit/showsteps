import {
  IMPROVE_SYSTEM_PROMPT,
  guideSteps,
  improvePrompt,
  parseImproved,
  summaryInput,
  toPlainText,
  translatableTexts,
  translatedCopy,
  updateStep,
  type Guide,
  type GuideStore,
  type RichText,
} from '@trailmark/core';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Dialog } from '../components/Dialog.js';
import { RichText as RichTextView } from '../components/RichText.js';
import { strings } from '../strings.js';
import {
  anyAi,
  detectAi,
  promptEach,
  summarize,
  translateAll,
  type AiCapabilities,
} from '../ai/builtin.js';

const s = strings.ai;

interface Suggestion {
  stepId: string;
  number: number;
  before: RichText;
  after: RichText;
}

type Panel =
  | { kind: 'improve'; suggestions: Suggestion[]; chosen: Set<string> }
  | { kind: 'summary'; text: string }
  | { kind: 'translate'; language: string }
  | { kind: 'message'; text: string; openId?: string };

/**
 * On-device AI tools (G7): improve step text, write a summary, translate as a copy. Shown only
 * when the setting is on and the browser has the matching built-in API.
 */
export function AiTools({
  store,
  guide,
  apply,
  onOpenGuide,
}: {
  store: GuideStore;
  guide: Guide;
  apply: (edit: (latest: Guide) => Guide) => void;
  onOpenGuide?: (guideId: string) => void;
}) {
  const [caps, setCaps] = useState<AiCapabilities>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);

  useEffect(() => {
    void detectAi().then(setCaps);
  }, []);
  if (!caps || !anyAi(caps)) return null;

  const work = async (task: () => Promise<Panel>) => {
    setOpen(false);
    setBusy(true);
    setPanel({ kind: 'message', text: s.working });
    try {
      setPanel(await task());
    } catch (error) {
      setPanel({
        kind: 'message',
        text: error instanceof Error && /download/i.test(error.message) ? s.downloading : s.failed,
      });
    } finally {
      setBusy(false);
    }
  };

  const improve = () =>
    work(async () => {
      const steps = guideSteps(guide);
      const replies = await promptEach(
        IMPROVE_SYSTEM_PROMPT,
        steps.map((st, i) => improvePrompt(guide.title, i + 1, st.human.title)),
      );
      const suggestions: Suggestion[] = [];
      steps.forEach((st, i) => {
        const after = parseImproved(replies[i] ?? '');
        if (after && toPlainText(after) !== toPlainText(st.human.title)) {
          suggestions.push({ stepId: st.id, number: i + 1, before: st.human.title, after });
        }
      });
      if (!suggestions.length) return { kind: 'message', text: s.noChanges };
      return { kind: 'improve', suggestions, chosen: new Set(suggestions.map((x) => x.stepId)) };
    });

  const summary = () =>
    work(async () => ({
      kind: 'summary',
      text: await summarize(summaryInput(guide), 'A step-by-step how-to guide for a web app.'),
    }));

  const translate = (language: string) =>
    work(async () => {
      const texts = translatableTexts(guide);
      const keys = [...texts.keys()];
      const out = await translateAll(
        keys.map((k) => texts.get(k) ?? ''),
        language,
      );
      const copy = translatedCopy(guide, new Map(keys.map((k, i) => [k, out[i] ?? ''])), language);
      for (const name of await store.listImages(guide.id)) {
        const bytes = await store.getImage(guide.id, name);
        if (bytes) await store.putImage(copy.id, name, bytes);
      }
      await store.saveGuide(copy);
      return { kind: 'message', text: s.translated(copy.title), openId: copy.id };
    });

  const close = () => setPanel(null);

  return (
    <div class="tm-popmenu">
      <Button
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
        onClick={() => setOpen(!open)}
      >
        {s.menu}
      </Button>
      {open ? (
        <div class="tm-popmenu__list" role="menu">
          {caps.improve ? (
            <button type="button" role="menuitem" onClick={() => void improve()}>
              {s.improve}
            </button>
          ) : null}
          {caps.summarize ? (
            <button type="button" role="menuitem" onClick={() => void summary()}>
              {s.summarize}
            </button>
          ) : null}
          {caps.translate ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setPanel({ kind: 'translate', language: 'fr' });
              }}
            >
              {s.translate}
            </button>
          ) : null}
        </div>
      ) : null}

      {panel?.kind === 'message' ? (
        <Dialog
          title={s.menu}
          onClose={close}
          actions={
            <>
              <Button onClick={close}>{strings.library.close}</Button>
              {panel.openId && onOpenGuide ? (
                <Button variant="primary" onClick={() => onOpenGuide(panel.openId ?? '')}>
                  {s.openCopy}
                </Button>
              ) : null}
            </>
          }
        >
          <p role="status">{panel.text}</p>
        </Dialog>
      ) : null}

      {panel?.kind === 'summary' ? (
        <Dialog
          title={s.summarize}
          onClose={close}
          actions={
            <>
              <Button onClick={close}>{s.discard}</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const text = panel.text;
                  apply((g) => ({ ...g, description: text }));
                  close();
                }}
              >
                {s.accept}
              </Button>
            </>
          }
        >
          <p class="tm-muted">{s.before}</p>
          <p>{guide.description || '—'}</p>
          <p class="tm-muted">{s.after}</p>
          <p>{panel.text}</p>
        </Dialog>
      ) : null}

      {panel?.kind === 'improve' ? (
        <Dialog
          title={s.review}
          onClose={close}
          actions={
            <>
              <Button onClick={close}>{s.discard}</Button>
              <Button
                variant="primary"
                disabled={!panel.chosen.size}
                onClick={() => {
                  const chosen = panel.suggestions.filter((x) => panel.chosen.has(x.stepId));
                  apply((g) =>
                    chosen.reduce(
                      (acc, x) =>
                        updateStep(acc, x.stepId, (st) => ({
                          ...st,
                          human: { ...st.human, title: x.after },
                        })),
                      g,
                    ),
                  );
                  close();
                }}
              >
                {s.acceptAll}
              </Button>
            </>
          }
        >
          <ul class="tm-checklist">
            {panel.suggestions.map((x) => (
              <li key={x.stepId}>
                <label class="tm-check">
                  <input
                    type="checkbox"
                    checked={panel.chosen.has(x.stepId)}
                    onChange={(e) => {
                      const chosen = new Set(panel.chosen);
                      if (e.currentTarget.checked) chosen.add(x.stepId);
                      else chosen.delete(x.stepId);
                      setPanel({ ...panel, chosen });
                    }}
                  />
                  <span>
                    <strong>{strings.guide.stepLabel(x.number)}</strong>
                    <span class="tm-muted tm-block-text">
                      {s.before}: <RichTextView value={x.before} />
                    </span>
                    <span class="tm-block-text">
                      {s.after}: <RichTextView value={x.after} />
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Dialog>
      ) : null}

      {panel?.kind === 'translate' ? (
        <Dialog
          title={s.translate}
          onClose={close}
          actions={
            <>
              <Button onClick={close}>{strings.library.cancel}</Button>
              <Button variant="primary" onClick={() => void translate(panel.language)}>
                {s.translateGo}
              </Button>
            </>
          }
        >
          <label class="tm-field">
            {s.language}
            <select
              class="tm-input"
              value={panel.language}
              onChange={(e) => setPanel({ kind: 'translate', language: e.currentTarget.value })}
            >
              {Object.entries(s.languages).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </Dialog>
      ) : null}
    </div>
  );
}
