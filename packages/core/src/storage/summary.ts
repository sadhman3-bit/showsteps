import { toPlainText } from '../richText.js';
import type { Guide } from '../schema.js';
import type { GuideSummary } from './types.js';

export function summarize(guide: Guide, trashedAt?: string): GuideSummary {
  const steps = guide.blocks.filter((b) => b.kind === 'step');
  const searchText = guide.blocks
    .map((b) => {
      if (b.kind === 'step') {
        return [
          toPlainText(b.human.title),
          b.human.description ? toPlainText(b.human.description) : '',
        ]
          .filter(Boolean)
          .join(' ');
      }
      return b.text;
    })
    .join('\n');
  const summary: GuideSummary = {
    id: guide.id,
    title: guide.title,
    tags: guide.tags,
    createdAt: guide.createdAt,
    updatedAt: guide.updatedAt,
    stepCount: steps.length,
    apps: guide.apps,
    searchText,
  };
  const shot = steps.find((st) => st.kind === 'step' && st.human.screenshot)?.human.screenshot;
  if (shot) summary.cover = thumbNameFor(shot.file);
  if (guide.description) summary.description = guide.description;
  if (guide.folderId) summary.folderId = guide.folderId;
  if (guide.author) summary.author = guide.author;
  if (guide.updatedBy) summary.updatedBy = guide.updatedBy;
  if (trashedAt) summary.trashedAt = trashedAt;
  return summary;
}

/** "img/abc.webp" → "abc.thumb.webp": the thumbnail stored next to a screenshot. */
export function thumbNameFor(file: string): string {
  const name = file.replace(/^img\//, '');
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}.thumb${name.slice(dot)}` : `${name}.thumb`;
}
