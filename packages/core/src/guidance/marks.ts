import { z } from 'zod';
import { RichTextSchema, TargetSchema } from '../schema.js';
import { pageKey } from './pages.js';

/**
 * Notes (G5) and pins (G4) that sit on web pages. A pin is a mark that opens a guide; a note
 * shows text and may also hold a guide. Stored apart from guides (they belong to pages).
 */
export const PageMarkSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(['note', 'pin']),
  tone: z.enum(['tip', 'warning', 'link']),
  /** `origin + path` of the page (see pageKey). */
  page: z.string().min(1).max(2048),
  /** The element it is attached to; absent for a whole-page mark. */
  target: TargetSchema.optional(),
  /** Frame URL when the element is inside an iframe. */
  frameUrl: z.string().max(2048).optional(),
  text: RichTextSchema,
  href: z
    .string()
    .max(2048)
    .regex(/^(https?:|mailto:)/i)
    .optional(),
  guideId: z.string().max(128).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PageMark = z.infer<typeof PageMarkSchema>;

export const PageMarksSchema = z.array(PageMarkSchema);

/** Marks that belong on the page (or frame) at `url`. */
export function marksForUrl(marks: PageMark[], url: string): PageMark[] {
  const key = pageKey(url);
  if (!key) return [];
  return marks.filter((m) => pageKey(m.frameUrl ?? m.page) === key);
}

/** Parse stored marks, dropping any entry that no longer validates. */
export function parseMarks(raw: unknown): PageMark[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m) => {
    const r = PageMarkSchema.safeParse(m);
    return r.success ? [r.data] : [];
  });
}
