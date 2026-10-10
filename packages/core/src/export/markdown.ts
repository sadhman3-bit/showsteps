import { strToU8, zipSync } from 'fflate';
import { toMarkdown } from '../richText.js';
import { extensionFor, exportDocument, type ExportInput } from './model.js';

function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<>#])/g, '\\$1');
}

function escapeAlt(text: string): string {
  return text.replace(/([\\[\]])/g, '\\$1');
}

/** `guide.md`: images are referenced as `img/step-01.png`. */
export function guideToMarkdown(input: ExportInput): string {
  const doc = exportDocument(input);
  const L = doc.labels;
  const out: string[] = [];
  if (input.logo) out.push(`![](img/logo.${extensionFor(input.logo)})`);
  out.push(`# ${escapeText(doc.title)}`);
  if (doc.description) out.push(escapeText(doc.description));
  out.push(`*${doc.meta}*`);
  if (doc.preconditions.length) {
    out.push(`**${L.before}**`);
    out.push(doc.preconditions.map((p) => `- ${escapeText(p)}`).join('\n'));
  }
  if (!doc.items.length) out.push(L.noSteps);
  for (const item of doc.items) {
    if (item.kind === 'heading') {
      out.push(`## ${escapeText(item.text)}`);
    } else if (item.kind === 'callout') {
      out.push(
        item.text
          .split('\n')
          .map((line, i) => `> ${i === 0 ? `**${item.label}:** ` : ''}${escapeText(line)}`)
          .join('\n'),
      );
    } else {
      out.push(`**${item.number}.** ${toMarkdown(item.title)}`);
      if (item.description) out.push(toMarkdown(item.description));
      if (item.imageName) out.push(`![${escapeAlt(item.alt)}](img/${item.imageName})`);
    }
  }
  if (doc.success) out.push(`**${L.success}:** ${escapeText(doc.success)}`);
  return out.join('\n\n') + '\n';
}

/** X3: `guide.md` plus `img/`, zipped. */
export function guideToMarkdownZip(input: ExportInput): Uint8Array {
  const doc = exportDocument(input);
  const img: Record<string, Uint8Array> = {};
  if (input.logo) img[`logo.${extensionFor(input.logo)}`] = input.logo.bytes;
  for (const item of doc.items) {
    if (item.kind === 'step' && item.image && item.imageName)
      img[item.imageName] = item.image.bytes;
  }
  return zipSync(
    { 'guide.md': strToU8(guideToMarkdown(input)), ...(Object.keys(img).length ? { img } : {}) },
    { level: 6, mtime: new Date('2000-01-01T00:00:00Z') },
  );
}
