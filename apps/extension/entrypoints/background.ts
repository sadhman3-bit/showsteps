import { IndexedDbStore } from '@trailmark/core';
import { FrameRegistry } from '../lib/frames';
import {
  ContentEventSchema,
  ContentMessageSchema,
  IframeGeometrySchema,
  PageMessageSchema,
  type Broadcast,
  type CaptureState,
  type ContentEvent,
  type ContentMessage,
  type PageMessage,
} from '../lib/messages';
import { Recorder, type EventSender, type PersistedRecorder, type Viewport } from '../lib/recorder';
import { recaptureStep } from '../lib/recapture';
import { encodeScreenshot } from '../lib/shots';

const SCRIPT_ID = 'trailmark-capture';
const SCRIPT_FILE = '/content-scripts/capture.js';
const PERSIST_KEY = 'recorder';
/** Navigations the user made directly (not caused by a recorded click). */
const DIRECT_TRANSITIONS = new Set([
  'typed',
  'auto_bookmark',
  'generated',
  'keyword',
  'keyword_generated',
]);

export default defineBackground(() => {
  const store = new IndexedDbStore(indexedDB);

  const frames = new FrameRegistry({
    async parentFrameId(tabId, frameId) {
      const frame = await browser.webNavigation.getFrame({ tabId, frameId });
      return frame?.parentFrameId ?? -1;
    },
    async iframeGeometry(tabId, frameId, token) {
      try {
        const reply: unknown = await browser.tabs.sendMessage(
          tabId,
          { type: 'iframe-geometry', token },
          { frameId },
        );
        const parsed = IframeGeometrySchema.safeParse(reply);
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
  });

  const broadcast = (msg: Broadcast) => {
    browser.runtime.sendMessage(msg).catch(() => undefined); // no extension page open
  };

  const recorder = new Recorder({
    store,
    frames,
    async captureVisibleTab(tabId, { windowId, uiHidden }) {
      const window = windowId ?? (await browser.tabs.get(tabId)).windowId;
      // Keep Trailmark's own controls out of the picture. Input in the top frame has already
      // hidden them; anything else (iframes, navigations) asks the top frame first.
      // Input in the top frame hid them synchronously, before asking; the message round trip
      // gives that change time to reach the screen. Anything else (iframes, navigations) asks.
      if (!uiHidden) {
        await browser.tabs
          .sendMessage(tabId, { type: 'overlays', visible: false }, { frameId: 0 })
          .catch(() => undefined);
      }
      try {
        return await browser.tabs.captureVisibleTab(window, { format: 'png' });
      } finally {
        browser.tabs.sendMessage(tabId, { type: 'overlays', visible: true }).catch(() => undefined);
      }
    },
    encode: (dataUrl) => encodeScreenshot(dataUrl),
    sendState(tabId, state) {
      browser.tabs.sendMessage(tabId, { type: 'state', state }).catch(() => undefined);
      if (state.status === 'idle') void unregisterScripts();
    },
    broadcastState: (state) => broadcast({ type: 'state', state }),
    libraryChanged: () => broadcast({ type: 'library-changed' }),
    async persist(data) {
      if (data) await browser.storage.session.set({ [PERSIST_KEY]: data });
      else await browser.storage.session.remove(PERSIST_KEY);
    },
  });

  // Resume a capture if the browser stopped this worker mid-recording.
  const ready = browser.storage.session
    .get(PERSIST_KEY)
    .then((r) =>
      r[PERSIST_KEY] ? recorder.restore(r[PERSIST_KEY] as PersistedRecorder) : undefined,
    )
    .catch(() => undefined);

  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
    console.error('Trailmark: could not set side panel behaviour', error);
  });

  // ---------- Content scripts ----------

  async function grantedOrigins(): Promise<string[]> {
    const all = await browser.permissions.getAll();
    return (all.origins ?? []).filter((o) => /^(https?|file):|^<all_urls>$|^\*:/.test(o));
  }

  async function registerScripts(): Promise<void> {
    const matches = await grantedOrigins();
    if (!matches.length) return;
    const existing = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length) return;
    await browser.scripting.registerContentScripts([
      {
        id: SCRIPT_ID,
        js: [SCRIPT_FILE],
        matches,
        allFrames: true,
        runAt: 'document_start',
        persistAcrossSessions: false,
      },
    ]);
  }

  async function unregisterScripts(): Promise<void> {
    if (recorder.isActive) return;
    const existing = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length) await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }

  /** Inject into a tab that is already open (registered scripts only cover new page loads). */
  async function injectInto(tabId: number): Promise<void> {
    await browser.scripting
      .executeScript({ target: { tabId, allFrames: true }, files: [SCRIPT_FILE] })
      .catch(() => undefined); // chrome:// pages, the Web Store, frames we may not access
  }

  async function viewportOf(tabId: number): Promise<Viewport | undefined> {
    try {
      const [result] = await browser.scripting.executeScript({
        target: { tabId },
        func: () => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }),
      });
      return result?.result as Viewport | undefined;
    } catch {
      return undefined;
    }
  }

  async function startCapture(msg: Extract<PageMessage, { type: 'start' }>): Promise<CaptureState> {
    const tab = await browser.tabs.get(msg.tabId);
    if (!tab.url || !/^(https?|file):/.test(tab.url)) throw new Error('cannot-record-here');
    const allowed = await browser.permissions.contains({ origins: [tab.url] });
    if (!allowed) throw new Error('permission-needed');
    const viewport = await viewportOf(msg.tabId);
    const state = await recorder.start({
      tabId: msg.tabId,
      url: tab.url,
      ...(tab.title ? { title: tab.title } : {}),
      ...(msg.guideId ? { guideId: msg.guideId } : {}),
      ...(msg.insertAt !== undefined ? { insertAt: msg.insertAt } : {}),
      ...(viewport ? { viewport } : {}),
    });
    await registerScripts();
    await injectInto(msg.tabId);
    return state;
  }

  // ---------- Messages ----------

  const extensionOrigin = browser.runtime.getURL('');

  async function handleContent(
    msg: ContentMessage,
    sender: Browser.runtime.MessageSender,
  ): Promise<unknown> {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return undefined;
    const frameId = sender.frameId ?? 0;
    switch (msg.type) {
      case 'hello':
        if (recorder.isActive) recorder.noteTab(tabId);
        return { state: recorder.current };
      case 'frame-register':
        frames.register(tabId, frameId, msg.token);
        return { ok: true };
      case 'viewport':
        if (frameId === 0) recorder.setViewport(tabId, msg.viewport);
        return { ok: true };
      case 'shot':
        await recorder.shot(tabId, msg.shotId, {
          ...(sender.tab?.windowId !== undefined ? { windowId: sender.tab.windowId } : {}),
          uiHidden: frameId === 0 && msg.uiHidden === true,
          ...(msg.at ? { inputAt: msg.at } : {}),
        });
        return { ok: true };
      case 'event':
        void recorder
          .event(
            {
              tabId,
              frameId,
              tabUrl: sender.tab?.url ?? sender.url ?? '',
              ...(sender.tab?.title ? { tabTitle: sender.tab.title } : {}),
              ...(sender.url ? { frameUrl: sender.url } : {}),
            },
            msg.event,
            msg.shotId,
          )
          .catch((error: unknown) => console.error('Trailmark: could not record step', error));
        return { ok: true };
      case 'control':
        return { state: await recorder.control(msg.action) };
    }
  }

  async function handlePage(msg: PageMessage): Promise<unknown> {
    switch (msg.type) {
      case 'start':
        try {
          return { state: await startCapture(msg) };
        } catch (error) {
          return {
            state: recorder.current,
            error: error instanceof Error ? error.message : 'error',
          };
        }
      case 'get-state':
        return { state: recorder.current };
      case 'control':
        return { state: await recorder.control(msg.action) };
      case 'recapture': {
        if (recorder.isActive) return { state: recorder.current, error: 'busy' };
        const tab = await browser.tabs.get(msg.tabId).catch(() => undefined);
        if (!tab?.url || !/^(https?|file):/.test(tab.url)) {
          return { state: recorder.current, error: 'cannot-record-here' };
        }
        try {
          await recaptureStep(
            store,
            msg.guideId,
            msg.stepId,
            () => browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' }),
            encodeScreenshot,
            (await viewportOf(msg.tabId))?.dpr ?? 1,
          );
          broadcast({ type: 'library-changed' });
          return { state: recorder.current };
        } catch {
          return { state: recorder.current, error: 'recapture-failed' };
        }
      }
    }
  }

  browser.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const fromExtensionPage =
      sender.url?.startsWith(extensionOrigin) && !sender.tab?.url?.match(/^(https?|file):/);
    const respond = (p: Promise<unknown>) => {
      p.then(sendResponse, (error: unknown) => {
        console.error('Trailmark:', error);
        sendResponse({ error: 'internal' });
      });
      return true;
    };
    if (fromExtensionPage) {
      const parsed = PageMessageSchema.safeParse(raw);
      if (!parsed.success) return false;
      return respond(ready.then(() => handlePage(parsed.data)));
    }
    const parsed = ContentMessageSchema.safeParse(raw);
    if (!parsed.success || !sender.tab) return false;
    return respond(ready.then(() => handleContent(parsed.data, sender)));
  });

  // ---------- Navigation and tabs ----------

  const pendingNav = new Set<number>();

  browser.webNavigation.onCommitted.addListener((d) => {
    if (d.frameId !== 0 || !recorder.isActive) return;
    recorder.noteNavigation(d.tabId, d.timeStamp);
    const direct =
      DIRECT_TRANSITIONS.has(d.transitionType) ||
      d.transitionQualifiers.includes('forward_back') ||
      d.transitionQualifiers.includes('from_address_bar');
    if (direct) pendingNav.add(d.tabId);
  });

  browser.webNavigation.onCompleted.addListener((d) => {
    if (d.frameId !== 0 || !pendingNav.delete(d.tabId)) return;
    void browser.tabs.get(d.tabId).then((tab) => recorder.navigated(d.tabId, d.url, tab.title));
  });

  // Capture follows the active tab, across tabs and windows.
  async function collectPendingTyping(tabIds: number[]) {
    const out: { sender: EventSender; event: ContentEvent }[] = [];
    for (const tabId of tabIds) {
      const tab = await browser.tabs.get(tabId).catch(() => undefined);
      if (!tab?.url) continue;
      const frames = (await browser.webNavigation.getAllFrames({ tabId }).catch(() => null)) ?? [];
      for (const frame of frames) {
        const reply: unknown = await browser.tabs
          .sendMessage(tabId, { type: 'flush' }, { frameId: frame.frameId })
          .catch(() => undefined);
        const parsed = ContentEventSchema.safeParse(
          (reply as { event?: unknown } | undefined)?.event,
        );
        if (!parsed.success) continue;
        out.push({
          sender: {
            tabId,
            frameId: frame.frameId,
            tabUrl: tab.url,
            ...(tab.title ? { tabTitle: tab.title } : {}),
            frameUrl: frame.url,
          },
          event: parsed.data,
        });
      }
    }
    return out;
  }

  browser.tabs.onActivated.addListener(({ tabId }) => {
    void ready.then(() => {
      if (!recorder.isActive) return;
      // Typing in the tab the user left has no "change" event yet: collect it from every frame
      // of the other tabs, in order, before anything recorded in the new tab.
      const others = recorder.trackedTabs.filter((t) => t !== tabId);
      if (others.length) void recorder.flush(() => collectPendingTyping(others));
      void injectInto(tabId);
    });
  });

  browser.tabs.onRemoved.addListener((tabId) => frames.forgetTab(tabId));

  // ---------- Keyboard shortcut ----------

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'toggle-capture') return;
    void ready.then(async () => {
      if (recorder.isActive) {
        await recorder.control('finish');
        return;
      }
      if (!tab?.id || !tab.url) return;
      const allowed = await browser.permissions.contains({ origins: [tab.url] }).catch(() => false);
      if (allowed) {
        await startCapture({ type: 'start', tabId: tab.id }).catch(() => undefined);
      } else if (tab.windowId !== undefined) {
        // Permission can only be granted from a click, so show the side panel's Start button.
        await browser.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
      }
    });
  });

  if (import.meta.env.MODE === 'e2e') {
    // Test hook for Playwright, compiled out of normal builds.
    Object.assign(globalThis, { __trailmark: { recorder, store, startCapture } });
  }
});
