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
  if (guide.description) summary.description = guide.description;
  if (guide.folderId) summary.folderId = guide.folderId;
  if (guide.author) summary.author = guide.author;
  if (guide.updatedBy) summary.updatedBy = guide.updatedBy;
  if (trashedAt) summary.trashedAt = trashedAt;
  return summary;
}
