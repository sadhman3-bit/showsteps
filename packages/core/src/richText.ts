import type { RichText, Span } from './schema.js';

export function plain(text: string): RichText {
  return { spans: text ? [{ text }] : [] };
}

/** Concatenated text with no formatting. */
export function toPlainText(rt: RichText): string {
  return rt.spans.map((s) => s.text).join('');
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, '\\$1');
}

/**
 * Markdown rendering: **bold**, *italic*, [text](href). Surrounding spaces move outside
 * the emphasis markers, because Markdown emphasis cannot start or end with whitespace.
 */
export function toMarkdown(rt: RichText): string {
  return rt.spans
    .map((s) => {
      const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(s.text);
      const [, lead = '', core = '', trail = ''] = match ?? [];
      if (!core) return s.text;
      let out = escapeMarkdown(core);
      if (s.italic) out = `*${out}*`;
      if (s.bold) out = `**${out}**`;
      if (s.href) out = `[${out}](${s.href.replace(/[()\s]/g, encodeURIComponent)})`;
      return lead + out + trail;
    })
    .join('');
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Safe HTML rendering. Only http(s)/mailto links survive (enforced by the schema too). */
export function toHtml(rt: RichText): string {
  return rt.spans
    .map((s) => {
      let out = escapeHtml(s.text);
      if (s.italic) out = `<em>${out}</em>`;
      if (s.bold) out = `<strong>${out}</strong>`;
      if (s.href && /^(https?:|mailto:)/i.test(s.href)) {
        out = `<a href="${escapeHtml(s.href)}" rel="noopener noreferrer">${out}</a>`;
      }
      return out;
    })
    .join('');
}

/** Merge adjacent spans that share formatting; drop empty spans. */
export function normalize(rt: RichText): RichText {
  const spans: Span[] = [];
  for (const s of rt.spans) {
    if (!s.text) continue;
    const prev = spans[spans.length - 1];
    if (prev && !!prev.bold === !!s.bold && !!prev.italic === !!s.italic && prev.href === s.href) {
      prev.text += s.text;
    } else {
      spans.push({ ...s });
    }
  }
  return { spans };
}
