import { z } from 'zod';

/** Where a comment or reaction sits: a block id, or the end of the guide. */
export const END_OF_GUIDE = 'end';

export const REACTIONS = ['👍', '🎉', '❤️', '👀', '❓'] as const;

const CommentSchema = z.object({
  id: z.string().min(1).max(64),
  blockId: z.string().min(1).max(128),
  text: z.string().min(1).max(4000),
  at: z.string(),
  editedAt: z.string().optional(),
});
export type Comment = z.infer<typeof CommentSchema>;

/** One person's comments and reactions on one guide (their own sidecar file). */
export const CommentsSidecarSchema = z.object({
  author: z.string().min(1).max(100),
  comments: z.array(CommentSchema),
  reactions: z.array(z.object({ blockId: z.string().min(1).max(128), emoji: z.enum(REACTIONS) })),
});
export type CommentsSidecar = z.infer<typeof CommentsSidecarSchema>;

export function emptyComments(author: string): CommentsSidecar {
  return { author, comments: [], reactions: [] };
}

export function parseComments(raw: unknown, author: string): CommentsSidecar {
  const r = CommentsSidecarSchema.safeParse(raw);
  return r.success ? r.data : emptyComments(author);
}

export interface ThreadComment extends Comment {
  author: string;
  /** Written by the person viewing (they may edit or delete it). */
  mine: boolean;
}

export interface Thread {
  comments: ThreadComment[];
  /** Emoji → people who reacted. */
  reactions: Map<string, string[]>;
}

/**
 * Merge everyone's sidecars into threads per block, oldest comment first. `me` is the
 * viewing user's slug-independent name as stored in their sidecar.
 */
export function mergeThreads(
  sidecars: { user: string; data: unknown }[],
  me: string,
): Map<string, Thread> {
  const threads = new Map<string, Thread>();
  const thread = (id: string) => {
    let t = threads.get(id);
    if (!t) {
      t = { comments: [], reactions: new Map() };
      threads.set(id, t);
    }
    return t;
  };
  for (const { user, data } of sidecars) {
    const side = CommentsSidecarSchema.safeParse(data);
    if (!side.success) continue;
    const author = side.data.author || user;
    for (const c of side.data.comments) {
      thread(c.blockId).comments.push({ ...c, author, mine: author === me });
    }
    for (const r of side.data.reactions) {
      const t = thread(r.blockId);
      t.reactions.set(r.emoji, [...(t.reactions.get(r.emoji) ?? []), author]);
    }
  }
  for (const t of threads.values()) t.comments.sort((a, b) => a.at.localeCompare(b.at));
  return threads;
}

export function toggleReaction(
  side: CommentsSidecar,
  blockId: string,
  emoji: (typeof REACTIONS)[number],
): CommentsSidecar {
  const has = side.reactions.some((r) => r.blockId === blockId && r.emoji === emoji);
  return {
    ...side,
    reactions: has
      ? side.reactions.filter((r) => !(r.blockId === blockId && r.emoji === emoji))
      : [...side.reactions, { blockId, emoji }],
  };
}
