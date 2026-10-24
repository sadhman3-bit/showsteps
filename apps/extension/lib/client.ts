// Helpers for extension pages (side panel, library) to talk to the background.
import { IndexedDbStore, type GuideStore } from '@showsteps/core';
import { BridgeClient, bridgeStore, switchableStore } from './bridge';
import { closeRunLogs } from './scheduleClient';
import { readSettings } from './settings';
import type { DownloadAccess, StepCheckView } from '@showsteps/ui';
import { strings } from '@showsteps/ui/strings';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  GUIDANCE_IDLE,
  SETTINGS_KEY,
  GuideBroadcastSchema,
  GuidanceStateSchema,
  SelfCheckReportSchema,
  type GuideBroadcast,
  type GuidePageMessage,
  type GuidanceState,
  type Speed,
} from './guideMessages';
import {
  BroadcastSchema,
  CAPTURE_MORE_KEY,
  CaptureMoreSchema,
  CaptureStateSchema,
  IDLE_STATE,
  RECAPTURE_KEY,
  RecaptureSchema,
  type CaptureMore,
  type CaptureState,
  type PageMessage,
  type Recapture,
} from './messages';

let store: GuideStore | undefined;
let local: IndexedDbStore | undefined;
let desktop: GuideStore | undefined;
let useDesktop: Promise<boolean> | undefined;

function desktopLibraryOn(): Promise<boolean> {
  useDesktop ??= readSettings().then((s) => s.desktopApp && s.desktopLibrary);
  return useDesktop;
}

/**
 * Settings → Delete all ShowSteps data: stop captures and guides, clear settings, notes and
 * pins, and delete the guide database in this browser.
 */
export async function deleteAllData(): Promise<void> {
  // Let go of the run-log database so the background can delete it.
  await closeRunLogs();
  const msg: PageMessage = { type: 'delete-all' };
  await browser.runtime.sendMessage(msg).catch(() => undefined);
  await local?.close();
  local = undefined;
  store = undefined;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('trailmark');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

/** This browser's own library (IndexedDB, shared with the service worker). */
export function getLocalStore(): IndexedDbStore {
  local ??= new IndexedDbStore(indexedDB);
  return local;
}

/**
 * The guide library pages work with: browser storage, or the desktop app's library (through
 * the bridge) once the person chose to keep guides there.
 */
export function getStore(): GuideStore {
  if (!store) {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && SETTINGS_KEY in changes) useDesktop = undefined;
    });
    let kind: GuideStore['kind'] = 'indexeddb';
    store = switchableStore(
      async () => {
        if (await desktopLibraryOn()) {
          kind = 'folder';
          desktop ??= bridgeStore(new BridgeClient('page'));
          return desktop;
        }
        kind = 'indexeddb';
        return getLocalStore();
      },
      () => kind,
    );
  }
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

export async function readRecapture(): Promise<Recapture | undefined> {
  const r = await browser.storage.session.get(RECAPTURE_KEY);
  const parsed = RecaptureSchema.safeParse(r[RECAPTURE_KEY]);
  return parsed.success ? parsed.data : undefined;
}

export function writeRecapture(value: Recapture | undefined): Promise<void> {
  return value
    ? browser.storage.session.set({ [RECAPTURE_KEY]: value })
    : browser.storage.session.remove(RECAPTURE_KEY);
}

/** Deep link to a step in the reader view. */
export function stepUrl(guideId: string, stepId: string): string {
  return browser.runtime.getURL(
    `/library.html#/guide/${encodeURIComponent(guideId)}/step/${encodeURIComponent(stepId)}`,
  );
}

// ---------- Guidance, notes and pins ----------

export async function guideRequest(
  msg: GuidePageMessage,
): Promise<{ guidance: GuidanceState; error?: string }> {
  const raw = (await browser.runtime.sendMessage(msg)) as
    { guidance?: unknown; error?: unknown } | undefined;
  const parsed = GuidanceStateSchema.safeParse(raw?.guidance);
  return {
    guidance: parsed.success ? parsed.data : { ...GUIDANCE_IDLE },
    ...(typeof raw?.error === 'string' ? { error: raw.error } : {}),
  };
}

/** Live Guide Me / Run for me state. */
export function useGuidance(): GuidanceState {
  const [state, setState] = useState<GuidanceState>({ ...GUIDANCE_IDLE });
  useEffect(() => {
    void guideRequest({ type: 'guide-get' }).then((r) => setState(r.guidance));
    const listener = (raw: unknown) => {
      const parsed = GuideBroadcastSchema.safeParse(raw);
      if (parsed.success && parsed.data.type === 'guidance') setState(parsed.data.state);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);
  return state;
}

/** Listen for guidance broadcasts other than state (picks, marks changes). */
export function useGuideBroadcast(handler: (msg: GuideBroadcast) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const listener = (raw: unknown) => {
      const parsed = GuideBroadcastSchema.safeParse(raw);
      if (parsed.success) ref.current(parsed.data);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);
}

/** The active tab of this window, kept current as the person switches or navigates. */
export interface ActiveTab {
  id?: number;
  url?: string;
  windowId?: number;
  favIconUrl?: string;
}

export function useActiveTab(): ActiveTab {
  const [tab, setTab] = useState<ActiveTab>({});
  useEffect(() => {
    const refresh = () =>
      void browser.tabs
        .query({ active: true, currentWindow: true })
        .then(([t]) =>
          setTab(t ? { id: t.id, url: t.url, windowId: t.windowId, favIconUrl: t.favIconUrl } : {}),
        )
        .catch(() => setTab({}));
    refresh();
    const onUpdated = (_id: number, info: { url?: string; status?: string }) => {
      if (info.url || info.status === 'complete') refresh();
    };
    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  return tab;
}

/** Chrome's optional `downloads` permission, for the editor's File control (1.2). */
export const downloadAccess: DownloadAccess = {
  has: () => browser.permissions.contains({ permissions: ['downloads'] }).catch(() => false),
  // The request is the first thing the click does: Chrome shows its prompt only then.
  request: () => browser.permissions.request({ permissions: ['downloads'] }).catch(() => false),
};

/** U7: dry-run a guide in a new tab (website access is requested first; it needs the click). */
export async function selfCheckGuide(guideId: string): Promise<StepCheckView[] | undefined> {
  const granted = await browser.permissions.request({ origins: ['<all_urls>'] });
  if (!granted) return undefined;
  const msg: GuidePageMessage = { type: 'guide-selfcheck', guideId };
  const raw = (await browser.runtime.sendMessage(msg)) as { checks?: unknown } | undefined;
  const parsed = SelfCheckReportSchema.safeParse(raw?.checks);
  return parsed.success ? parsed.data : undefined;
}

/** The message for a guidance start that didn't happen. */
export function startError(error: string): string {
  return error === 'permission-needed'
    ? strings.guidance.permission
    : error === 'no-web-steps'
      ? strings.guidance.noWebSteps
      : error === 'busy'
        ? strings.schedules.busy
        : strings.guidance.startFailed;
}

/**
 * Start Guide Me or Run for me from a click. Website access is requested first (it needs the
 * click), then the side panel opens in that window so the step list is beside the page.
 */
export async function startGuide(opts: {
  guideId: string;
  mode: 'guide' | 'run';
  tabId?: number;
  windowId?: number;
  values?: Record<string, string>;
  speed?: Speed;
  stepThrough?: boolean;
  /** Settles when the editor has saved pending edits (the run uses the saved guide). */
  saved?: Promise<unknown>;
  /** Started from a link in an exported file: the tab goes to the exact start page first. */
  fromLink?: boolean;
}): Promise<string | undefined> {
  const { saved, ...start } = opts;
  const granted = await browser.permissions.request({ origins: ['<all_urls>'] });
  if (!granted) return 'permission-needed';
  await saved?.catch(() => undefined);
  const reply = await guideRequest({ type: 'guide-start', ...start });
  return reply.error;
}
