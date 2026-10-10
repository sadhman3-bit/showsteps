import { createId, nowIso } from './ids.js';
import { normalize, toMarkdown, toPlainText } from './richText.js';
import type { Guide, RichText, Span } from './schema.js';

/**
 * Helpers for the optional on-device AI (G7). The apps call the browser's built-in models;
 * these functions only build prompts and apply results, so they are deterministic and tested.
 */

/** Read back the Markdown subset `toMarkdown` writes: **bold**, *italic*, [text](https://…), \escapes. */
export function fromMarkdown(md: string, base: Omit<Span, 'text'> = {}): RichText {
  const spans: Span[] = [];
  let bold = !!base.bold;
  let italic = !!base.italic;
  let buf = '';
  const flush = () => {
    if (buf)
      spans.push({
        text: buf,
        ...(bold ? { bold } : {}),
        ...(italic ? { italic } : {}),
        ...(base.href ? { href: base.href } : {}),
      });
    buf = '';
  };
  for (let i = 0; i < md.length; i++) {
    const c = md.charAt(i);
    if (c === '\\' && /[\\`*_[\]<>#]/.test(md.charAt(i + 1))) {
      buf += md.charAt(++i);
    } else if (c === '*' && md.charAt(i + 1) === '*') {
      flush();
      bold = !bold;
      i++;
    } else if (c === '*') {
      flush();
      italic = !italic;
    } else if (c === '[' && !base.href) {
      const link = /^\[((?:\\.|[^\]\\])+)\]\(((?:https?:|mailto:)[^)\s]+)\)/.exec(md.slice(i));
      if (link?.[1] && link[2]) {
        flush();
        spans.push(
          ...fromMarkdown(link[1], {
            ...(bold ? { bold } : {}),
            ...(italic ? { italic } : {}),
            href: link[2],
          }).spans,
        );
        i += link[0].length - 1;
      } else buf += c;
    } else buf += c;
  }
  flush();
  return normalize({ spans });
}

/** System prompt for "Improve step text". Describes the task; no instructions to ignore. */
export const IMPROVE_SYSTEM_PROMPT =
  'You edit the steps of a how-to guide. Rewrite each step instruction so it is short, clear ' +
  'and starts with a verb. Keep names of buttons, fields and menus exactly as given, in ' +
  '**bold**. Keep any typed values exactly. Reply with the rewritten instruction only.';

export function improvePrompt(guideTitle: string, stepNumber: number, title: RichText): string {
  return `Guide: ${guideTitle}\nStep ${stepNumber}: ${toMarkdown(title)}`;
}

/** Clean a model reply into a step title: one line, no "Step 3:" prefix or quotes. */
export function parseImproved(reply: string): RichText | undefined {
  const line = reply
    .trim()
    .split('\n')[0]
    ?.replace(/^(step\s*\d+\s*[:.-]\s*)/i, '')
    .replace(/^["“']|["”']$/g, '')
    .trim();
  if (!line || line.length > 300) return undefined;
  const rt = fromMarkdown(line);
  return toPlainText(rt).trim() ? rt : undefined;
}

/** Text the summariser reads to write a guide description. */
export function summaryInput(guide: Guide): string {
  const lines = [guide.title];
  let n = 0;
  for (const b of guide.blocks) {
    if (b.kind === 'heading') lines.push(b.text);
    else if (b.kind === 'step') lines.push(`${++n}. ${toPlainText(b.human.title)}`);
  }
  return lines.join('\n');
}

/** Every piece of reader-facing text in a guide, keyed by where it goes. */
export function translatableTexts(guide: Guide): Map<string, string> {
  const out = new Map<string, string>();
  const put = (key: string, text: string | undefined) => {
    if (text?.trim()) out.set(key, text);
  };
  put('title', guide.title);
  put('description', guide.description);
  put('success', guide.success);
  guide.preconditions.forEach((p, i) => put(`pre:${i}`, p));
  for (const b of guide.blocks) {
    if (b.kind === 'heading' || b.kind === 'callout') put(`block:${b.id}`, b.text);
    else {
      put(`title:${b.id}`, toMarkdown(b.human.title));
      if (b.human.description) put(`desc:${b.id}`, toMarkdown(b.human.description));
      put(`alt:${b.id}`, b.human.altText);
    }
  }
  return out;
}

/**
 * A translated copy of `guide` (new id, same screenshots by name). Texts missing from
 * `translated` keep the original. The caller copies images to the new id.
 */
export function translatedCopy(
  guide: Guide,
  translated: Map<string, string>,
  languageTag: string,
): Guide {
  const t = (key: string, fallback: string) => translated.get(key)?.trim() || fallback;
  const at = nowIso();
  const copy: Guide = {
    ...structuredClone(guide),
    id: createId(),
    title: t('title', guide.title),
    tags: [...new Set([...guide.tags, languageTag])],
    createdAt: at,
    updatedAt: at,
    preconditions: guide.preconditions.map((p, i) => t(`pre:${i}`, p)),
  };
  if (guide.description) copy.description = t('description', guide.description);
  if (guide.success) copy.success = t('success', guide.success);
  copy.blocks = copy.blocks.map((b) => {
    if (b.kind === 'heading' || b.kind === 'callout')
      return { ...b, text: t(`block:${b.id}`, b.text) };
    const human = { ...b.human };
    const title = translated.get(`title:${b.id}`);
    if (title?.trim()) human.title = fromMarkdown(title);
    const desc = translated.get(`desc:${b.id}`);
    if (desc?.trim() && human.description) human.description = fromMarkdown(desc);
    if (human.altText) human.altText = t(`alt:${b.id}`, human.altText);
    return { ...b, human };
  });
  return copy;
}
