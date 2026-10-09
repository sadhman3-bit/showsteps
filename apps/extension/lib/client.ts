// Helpers for extension pages (side panel, library) to talk to the background.
import { IndexedDbStore } from '@trailmark/core';
import { useEffect, useState } from 'preact/hooks';
import {
  BroadcastSchema,
  CAPTURE_MORE_KEY,
  CaptureMoreSchema,
  CaptureStateSchema,
  IDLE_STATE,
  type CaptureMore,
  type CaptureState,
  type PageMessage,
} from './messages';

let store: IndexedDbStore | undefined;

/** The extension's guide library (shared IndexedDB origin with the background). */
export function getStore(): IndexedDbStore {
  store ??= new IndexedDbStore(indexedDB);
  return store;
}

export interface Reply {
  state: CaptureState;
  error?: string;
}

export async function request(msg: PageMessage): Promise<Reply> {
  const raw = (await browser.runtime.sendMessage(msg)) as
    { state?: unknown; error?: unknown } | undefined;
  const parsed = CaptureStateSchema.safeParse(raw?.state);
  return {
    state: parsed.success ? parsed.data : { ...IDLE_STATE },
    ...(typeof raw?.error === 'string' ? { error: raw.error } : {}),
  };
}

/** Live capture state and a counter that changes whenever the library does. */
export function useBackground(): { state: CaptureState; libraryVersion: number } {
  const [state, setState] = useState<CaptureState>({ ...IDLE_STATE });
  const [libraryVersion, setVersion] = useState(0);
  useEffect(() => {
    void request({ type: 'get-state' }).then((r) => setState(r.state));
    const listener = (raw: unknown) => {
      const parsed = BroadcastSchema.safeParse(raw);
      if (!parsed.success) return;
      if (parsed.data.type === 'state') {
        setState(parsed.data.state);
        setVersion((v) => v + 1);
      } else {
        setVersion((v) => v + 1);
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);
  return { state, libraryVersion };
}

export async function readCaptureMore(): Promise<CaptureMore | undefined> {
  const r = await browser.storage.session.get(CAPTURE_MORE_KEY);
  const parsed = CaptureMoreSchema.safeParse(r[CAPTURE_MORE_KEY]);
  return parsed.success ? parsed.data : undefined;
}

export function writeCaptureMore(value: CaptureMore | undefined): Promise<void> {
  return value
    ? browser.storage.session.set({ [CAPTURE_MORE_KEY]: value })
    : browser.storage.session.remove(CAPTURE_MORE_KEY);
}

export function libraryUrl(guideId?: string): string {
  return browser.runtime.getURL(
    `/library.html${guideId ? `#/guide/${encodeURIComponent(guideId)}` : ''}`,
  );
}
