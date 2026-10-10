import {
  createId,
  END_OF_GUIDE,
  mergeThreads,
  nowIso,
  parseComments,
  REACTIONS,
  toggleReaction,
  type CommentsSidecar,
  type GuideStore,
  type Thread,
} from '@trailmark/core';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { strings } from '../strings.js';
import { relativeTime } from '../time.js';

const s = strings.social;
type Emoji = (typeof REACTIONS)[number];

export interface CommentsApi {
  threads: Map<string, Thread>;
  user: string;
  post(blockId: string, text: string): Promise<void>;
  remove(commentId: string): Promise<void>;
  react(blockId: string, emoji: Emoji): Promise<void>;
}

/**
 * Comments and reactions (L4) for one guide. Each person writes only their own sidecar, so a
 * shared folder never has two people writing the same file; everyone's are merged to read.
 */
export function useComments(store: GuideStore, guideId: string, user: string): CommentsApi {
  const [threads, setThreads] = useState<Map<string, Thread>>(new Map());
  const reload = useCallback(async () => {
    const all = await store.listSidecars(guideId, 'comments').catch(() => []);
    setThreads(mergeThreads(all, user));
  }, [store, guideId, user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const update = async (change: (mine: CommentsSidecar) => CommentsSidecar) => {
    const mine = parseComments(await store.readSidecar(guideId, 'comments', user), user);
    await store.writeSidecar(guideId, 'comments', user, change({ ...mine, author: user }));
    await reload();
  };

  return {
    threads,
    user,
    post: (blockId, text) =>
      update((mine) => ({
        ...mine,
        comments: [...mine.comments, { id: createId(), blockId, text, at: nowIso() }],
      })),
    remove: (commentId) =>
      update((mine) => ({ ...mine, comments: mine.comments.filter((c) => c.id !== commentId) })),
    react: (blockId, emoji) => update((mine) => toggleReaction(mine, blockId, emoji)),
  };
}

/** Reactions and a collapsible comment thread under a step (or at the end of the guide). */
export function CommentBox({ api, blockId }: { api: CommentsApi; blockId: string }) {
  const thread = api.threads.get(blockId);
  const comments = thread?.comments ?? [];
  const [open, setOpen] = useState(blockId === END_OF_GUIDE);
  const [text, setText] = useState('');
  const submit = async (e: Event) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    await api.post(blockId, value);
    setText('');
  };
  return (
    <div class="tm-social" data-block={blockId}>
      <div class="tm-social__bar">
        {REACTIONS.map((emoji) => {
          const who = thread?.reactions.get(emoji) ?? [];
          const mine = who.includes(api.user);
          return (
            <button
              key={emoji}
              type="button"
              class="tm-react"
              aria-pressed={mine}
              aria-label={s.react(emoji)}
              title={who.length ? s.reactedBy(who) : s.react(emoji)}
              onClick={() => void api.react(blockId, emoji)}
            >
              {emoji}
              {who.length ? <span>{who.length}</span> : null}
            </button>
          );
        })}
        {blockId !== END_OF_GUIDE ? (
          <button type="button" class="tm-link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {comments.length ? s.comments(comments.length) : s.addComment}
          </button>
        ) : null}
      </div>
      {open ? (
        <div class="tm-social__thread">
          {comments.length ? (
            <ul>
              {comments.map((c) => (
                <li key={c.id}>
                  <p class="tm-social__meta">
                    <strong>{c.mine ? s.you(c.author) : c.author}</strong>{' '}
                    <span class="tm-muted">{relativeTime(c.at)}</span>
                    {c.mine ? (
                      <button type="button" class="tm-link" onClick={() => void api.remove(c.id)}>
                        {s.delete}
                      </button>
                    ) : null}
                  </p>
                  <p class="tm-social__text">{c.text}</p>
                </li>
              ))}
            </ul>
          ) : null}
          <form class="tm-social__form" onSubmit={(e) => void submit(e)}>
            <label class="tm-visually-hidden" for={`tm-c-${blockId}`}>
              {s.addComment}
            </label>
            <textarea
              id={`tm-c-${blockId}`}
              class="tm-input"
              rows={2}
              placeholder={s.addComment}
              value={text}
              onInput={(e) => setText(e.currentTarget.value)}
            />
            <Button type="submit" disabled={!text.trim()}>
              {s.post}
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
