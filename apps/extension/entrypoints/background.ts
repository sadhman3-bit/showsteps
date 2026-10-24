import {
  IndexedDbStore,
  LIGHT,
  guideSteps,
  guideStartUrl,
  guideVersion,
  marksForUrl,
  pageKey,
  parseStartLink,
  type CaptureEvent,
  type Guide,
} from '@showsteps/core';
import { BridgeClient, bridgeStore, readDownloadVia, switchableStore } from '../lib/bridge';
import { FrameRegistry } from '../lib/frames';
import { Guidance, type PersistedGuidance, type StartOptions } from '../lib/guidance';
import { selfCheck, type SelfCheckDeps } from '../lib/selfcheck';
import {
  GuideContentMessageSchema,
  GuidePageMessageSchema,
  type GuideBroadcast,
  type GuideContentMessage,
  type GuidePageMessage,
  type GuideToContent,
} from '../lib/guideMessages';
import { readMarks, readSettings, writeMarks } from '../lib/settings';
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
import {
  Recorder,
  type DesktopShot,
  type EventSender,
  type PersistedRecorder,
  type Viewport,
} from '../lib/recorder';
import { recaptureStep } from '../lib/recapture';
import { RUNLOGS_DB, RunLogStore } from '../lib/runlogs';
import { MAX_FILE_BYTES, RUNFILES_DB, RunFileStore } from '../lib/runfiles';
import { htmlAllowed, type DownloadInfo } from '../lib/attachments';
import { noticeText } from '../lib/notices';
import { installSamples } from '../lib/samples';
import { Scheduler, SCHEDULES_KEY, type Notice } from '../lib/schedules';
import { encodeLogShot, encodeScreenshot } from '../lib/shots';

const SCRIPT_ID = 'showsteps-capture';
const SCRIPT_FILE = '/content-scripts/capture.js';
const PERSIST_KEY = 'recorder';
const GUIDANCE_KEY = 'guidance';
const GUIDE_SCRIPT_ID = 'showsteps-guide';
const GUIDE_SCRIPT_FILE = '/content-scripts/guide.js';
/** Navigations the user made directly (not caused by a recorded click). */
const DIRECT_TRANSITIONS = new Set([
  'typed',
  'auto_bookmark',
  'generated',
  'keyword',
  'keyword_generated',
]);

export default defineBackground(() => {
  const local = new IndexedDbStore(indexedDB);

  // ---------- Desktop app bridge ----------

  let desktopLibrary = false;
  const bridge = new BridgeClient(
    'background',
    (event, data) => void onDesktopEvent(event, data),
    (connected) => {
      broadcast({ type: 'desktop-state', connected });
      if (connected) {
        bridge.sendEvent('capture-state', recorder.current);
        // S4: a desktop app that can open Chrome for runs learns the next due time.
        void scheduler.nextDueAt().then(sendNextDue);
      } else desktopDisconnected();
    },
  );
  const desktop = bridgeStore(bridge);

  /** Tell the desktop app when the next run is due (desktop app 1.0 never gets this). */
  function sendNextDue(at: Date | undefined): void {
    if (bridge.can('schedule-wake'))
      bridge.sendEvent('schedule-next', { at: at ? at.toISOString() : null });
  }
  /** Guides live in the desktop library once the person chose that and the app is reachable. */
  const store = switchableStore(
    async () => (desktopLibrary && (await bridge.connect()) ? desktop : local),
    () => (desktopLibrary && bridge.connected ? 'folder' : 'indexeddb'),
  );
  let retry: ReturnType<typeof setTimeout> | undefined;

  /** Connect when the setting is on (and keep trying every 15 s while the app is closed). */
  async function syncDesktop(): Promise<boolean> {
    clearTimeout(retry);
    const settings = await readSettings();
    desktopLibrary = settings.desktopApp && settings.desktopLibrary;
    const allowed = await browser.permissions
      .contains({ permissions: ['nativeMessaging'] })
      .catch(() => false);
    if (!settings.desktopApp || !allowed) {
      bridge.disconnect();
      return false;
    }
    const ok = await bridge.connect();
    if (!ok) retry = setTimeout(() => void syncDesktop(), 15_000);
    return ok;
  }

  function desktopDisconnected(): void {
    clearTimeout(retry);
    retry = setTimeout(() => void syncDesktop(), 15_000);
  }

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

  const broadcast = (msg: Broadcast | GuideBroadcast) => {
    browser.runtime.sendMessage(msg).catch(() => undefined); // no extension page open
  };

  /** WebP quality for pictures (Settings), set when a capture starts. */
  let shotQuality = 0.92;
  const recorder = new Recorder({
    store,
    frames,
    async captureVisibleTab(tabId, { windowId, uiHidden }) {
      const window = windowId ?? (await browser.tabs.get(tabId)).windowId;
      // Keep ShowSteps's own controls out of the picture. Input in the top frame has already
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
        // Release the hiding asked for above (input in the page releases its own, below).
        if (!uiHidden)
          browser.tabs
            .sendMessage(tabId, { type: 'overlays', visible: true }, { frameId: 0 })
            .catch(() => undefined);
      }
    },
    encode: (dataUrl) => encodeScreenshot(dataUrl, shotQuality),
    sendState(tabId, state) {
      browser.tabs.sendMessage(tabId, { type: 'state', state }).catch(() => undefined);
      if (state.status === 'idle') void unregisterScripts();
    },
    broadcastState: (state) => {
      broadcast({ type: 'state', state });
      bridge.sendEvent('capture-state', state);
    },
    libraryChanged: () => broadcast({ type: 'library-changed' }),
    replaced: (guideId, _stepId, added) => void resumeAfterRecapture(guideId, added),
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

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  /** Tabs, pages and frames: shared by Guide Me, Run for me and the self-check. */
  const pageDeps: SelfCheckDeps = {
    tabUrl: async (tabId) => (await browser.tabs.get(tabId).catch(() => undefined))?.url,
    async openTab(url, windowId) {
      const tab = await browser.tabs.create({
        url,
        active: true,
        ...(windowId !== undefined ? { windowId } : {}),
      });
      if (tab.id === undefined) throw new Error('no-tab');
      return tab.id;
    },
    async navigate(tabId, url) {
      await browser.tabs.update(tabId, { url });
    },
    async waitLoaded(tabId, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const tab = await browser.tabs.get(tabId).catch(() => undefined);
        if (!tab || tab.status === 'complete') return;
        await sleep(100);
      }
    },
    async frames(tabId) {
      const frames = (await browser.webNavigation.getAllFrames({ tabId })) ?? [];
      return frames.map((f) => ({ frameId: f.frameId, url: f.url }));
    },
    send: (tabId, msg, frameId) =>
      frameId === undefined
        ? browser.tabs.sendMessage(tabId, msg)
        : browser.tabs.sendMessage(tabId, msg, { frameId }),
    sleep,
  };
  // ---------- Files a run downloaded (1.2) ----------

  const runFiles = new RunFileStore(indexedDB);
  const hasDownloadAccess = () =>
    browser.permissions.contains({ permissions: ['downloads'] }).catch(() => false);
  /**
   * Fetch a finished download's own address again, with the site's cookies (ShowSteps's site
   * access makes Chrome send them). Only http(s), only with access to that site, and only when
   * the size matches and it isn't an HTML page standing in for the file (a sign-in page).
   */
  async function refetch(d: DownloadInfo): Promise<Blob | undefined> {
    const url = d.finalUrl || d.url;
    let origin: string;
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return undefined;
      origin = u.origin;
    } catch {
      return undefined;
    }
    if (!(await browser.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false)))
      return undefined;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return undefined;
    if (/text\/html/i.test(res.headers.get('content-type') ?? '') && !htmlAllowed(d))
      return undefined;
    const blob = await res.blob();
    if (blob.size > MAX_FILE_BYTES) return undefined;
    if (d.fileSize && d.fileSize > 0 && blob.size !== d.fileSize) return undefined;
    return blob;
  }

  const guidance = new Guidance({
    ...pageDeps,
    attach: {
      files: runFiles,
      hasDownloadAccess,
      refetch,
      // Desktop app 1.2: reads the file Chrome saved (works for form posts and one-time links).
      readDownload: (d) => readDownloadVia(bridge, d),
    },
    store,
    userName: async () => (await readSettings()).userName,
    broadcast: (state) => {
      broadcast({ type: 'guidance', state });
      if (state.scheduleId) void scheduler.onGuidance(state);
    },
    async persist(data) {
      if (data) await browser.storage.session.set({ [GUIDANCE_KEY]: data });
      else await browser.storage.session.remove(GUIDANCE_KEY);
    },
    now: () => new Date().toISOString(),
    desktop: {
      available: () => bridge.connected,
      show: (step, number, total) => bridge.sendEvent('desktop-step', { step, number, total }),
      clear: () => bridge.sendEvent('desktop-step-clear'),
    },
  });
  const guidanceReady = browser.storage.session
    .get(GUIDANCE_KEY)
    .then(async (r) => {
      const saved = r[GUIDANCE_KEY] as PersistedGuidance | undefined;
      // Files left by a run that isn't going any more (Chrome closed mid-run) are deleted.
      await runFiles.deleteExcept(saved?.files ? saved.run.id : undefined).catch(() => undefined);
      if (saved) await guidance.restore(saved);
    })
    .catch(() => undefined);

  // ---------- Guide Me and Run for me links in exported files (1.2) ----------

  /** When each tab last showed the start window: at most one every 10 seconds. */
  const linkPrompts = new Map<number, number>();
  const LINK_PROMPT_MS = 10_000;

  /**
   * A top-frame page opened with the ShowSteps marker in its fragment: offer to start, in a
   * small ShowSteps window the page can't cover or click. Nothing starts until Start is pressed.
   */
  async function onLinkNavigation(details: { tabId: number; frameId: number; url: string }) {
    if (details.frameId !== 0 || details.tabId < 0) return;
    const link = parseStartLink(details.url);
    if (!link) return;
    const last = linkPrompts.get(details.tabId) ?? 0;
    if (Date.now() - last < LINK_PROMPT_MS) return;
    linkPrompts.set(details.tabId, Date.now());
    await Promise.all([ready, guidanceReady]);
    const guide = await store.getGuide(link.guideId).catch(() => undefined);
    // Only on the guide's own start page (a guide not in the library can't be checked, so the
    // window says it isn't there).
    if (guide) {
      const start = guideStartUrl(guide);
      if (!start || pageKey(start) !== pageKey(details.url)) return;
    }
    const query = new URLSearchParams({
      mode: link.mode,
      tab: String(details.tabId),
      v: link.version,
    });
    await browser.windows
      .create({
        url: browser.runtime.getURL(
          `/library.html#/start/${encodeURIComponent(link.guideId)}?${query.toString()}`,
        ),
        type: 'popup',
        width: 440,
        height: 600,
        focused: true,
      })
      .catch(() => undefined);
  }
  browser.webNavigation.onCommitted.addListener((d) => void onLinkNavigation(d));
  browser.webNavigation.onReferenceFragmentUpdated.addListener((d) => void onLinkNavigation(d));
  browser.tabs.onRemoved.addListener((tabId) => linkPrompts.delete(tabId));

  /** Not now: take the marker out of the address bar without reloading (with site access). */
  async function dismissStartLink(tabId: number): Promise<void> {
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    if (!tab?.url || !parseStartLink(tab.url)) return;
    const origin = new URL(tab.url).origin;
    if (!(await browser.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false)))
      return;
    await browser.scripting
      .executeScript({
        target: { tabId },
        func: () => {
          if (location.hash.startsWith('#showsteps='))
            history.replaceState(history.state, '', location.href.split('#')[0]);
        },
      })
      .catch(() => undefined);
  }

  // `downloads` is optional: its events exist only once it is granted.
  let watchingDownloads = false;
  function watchDownloads(): void {
    if (watchingDownloads || !browser.downloads) return;
    watchingDownloads = true;
    browser.downloads.onCreated.addListener((item) => guidance.downloadCreated(item));
    browser.downloads.onChanged.addListener((delta) => {
      const state = delta.state?.current;
      if (state !== 'complete' && state !== 'interrupted') return;
      void browser.downloads
        .search({ id: delta.id })
        .then(([item]) => item && guidance.downloadEnded(item))
        .catch(() => undefined);
    });
  }
  watchDownloads();
  browser.permissions.onAdded.addListener(() => watchDownloads());

  // ---------- Scheduled runs ----------

  const runLogs = new RunLogStore(indexedDB);
  /** Chrome's notifications, when the person allowed them; the badge covers stops otherwise. */
  async function notify(notice: Notice): Promise<void> {
    const allowed = await browser.permissions
      .contains({ permissions: ['notifications'] })
      .catch(() => false);
    if (!allowed) return;
    const { title, message, buttons } = noticeText(notice);
    await browser.notifications
      .create(`ss|${notice.kind}|${notice.scheduleId}|${Date.now()}`, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('/icon/128.png'),
        title,
        message,
        ...(buttons.length ? { buttons: buttons.map((title) => ({ title })) } : {}),
        requireInteraction: notice.kind === 'paused' || notice.kind === 'due',
      })
      .catch(() => undefined);
  }

  async function attention(on: boolean): Promise<void> {
    await browser.action.setBadgeBackgroundColor({ color: LIGHT.alert }).catch(() => undefined);
    await browser.action.setBadgeText({ text: on ? '!' : '' }).catch(() => undefined);
  }

  /** A window for a scheduled run or check: normal size, not focused, never minimised. */
  async function backgroundWindow(url: string): Promise<{ windowId: number; tabId: number }> {
    const win = await browser.windows.create({
      url,
      focused: false,
      state: 'normal',
      type: 'normal',
      width: 1280,
      height: 900,
    });
    const tabId = win?.tabs?.[0]?.id;
    if (win?.id === undefined || tabId === undefined) throw new Error('no-window');
    await pageDeps.waitLoaded(tabId, 15_000);
    return { windowId: win.id, tabId };
  }

  /** U7 dry run for a schedule's "check first", in its own window, closed afterwards. */
  async function backgroundSelfCheck(guide: Guide): Promise<number[]> {
    let windowId: number | undefined;
    try {
      const checks = await selfCheck(guide, {
        ...pageDeps,
        async openTab(url) {
          const opened = await backgroundWindow(url);
          windowId = opened.windowId;
          return opened.tabId;
        },
        async waitLoaded(tabId, timeoutMs) {
          await pageDeps.waitLoaded(tabId, timeoutMs);
          await injectGuide(tabId);
        },
      });
      return checks.filter((c) => c.status === 'missing').map((c) => c.number);
    } finally {
      if (windowId !== undefined) await browser.windows.remove(windowId).catch(() => undefined);
    }
  }

  const scheduler = new Scheduler({
    now: () => new Date(),
    storage: {
      get: async (key) => (await browser.storage.local.get(key))[key],
      set: (key, value) => browser.storage.local.set({ [key]: value }),
    },
    getGuide: (id) => store.getGuide(id),
    alarms: {
      create: (name, when) => void browser.alarms.create(name, { when }),
      clear: (name) => browser.alarms.clear(name),
      names: async () => (await browser.alarms.getAll()).map((a) => a.name),
    },
    busy: () => recorder.isActive || guidance.isActive,
    openWindow: backgroundWindow,
    async startGuidance(run) {
      await startGuidance(
        {
          type: 'guide-start',
          guideId: run.guideId,
          mode: 'run',
          tabId: run.tabId,
          windowId: run.windowId,
          values: run.values,
        },
        { approved: run.approved, scheduleId: run.scheduleId, windowId: run.windowId },
      );
    },
    stopGuidance: async () => void (await guidance.control('stop')),
    closeWindow: (windowId) => browser.windows.remove(windowId),
    async capture(windowId) {
      const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
      return encodeLogShot(dataUrl);
    },
    logs: runLogs,
    notify: (notice) => void notify(notice),
    attention: (on) => void attention(on),
    selfCheck: backgroundSelfCheck,
    attachedFile: (stepId) => guidance.attachedFile(stepId),
    nextDue: sendNextDue,
    changed: () => broadcast({ type: 'schedules-changed' }),
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    void Promise.all([ready, guidanceReady]).then(() => scheduler.onAlarm(alarm.name));
  });
  // Alarms are cleared when the extension updates, and runs may have been missed while Chrome
  // was closed: rebuild and catch up whenever Chrome starts or ShowSteps is installed or updated.
  browser.runtime.onStartup.addListener(() => {
    void Promise.all([ready, guidanceReady]).then(() => scheduler.startup());
  });
  void scheduler.needsAttention().then((on) => attention(on));

  async function onNotificationClick(id: string, button?: number): Promise<void> {
    const [, kind, scheduleId = ''] = id.split('|');
    await browser.notifications.clear(id).catch(() => undefined);
    if (kind === 'due') {
      if (button === 0) await scheduler.startNow(scheduleId);
      return;
    }
    const windowId = await scheduler.runWindow();
    if (windowId !== undefined) {
      await browser.windows.update(windowId, { focused: true }).catch(() => undefined);
      return;
    }
    await browser.tabs
      .create({ url: browser.runtime.getURL('/library.html#/schedules') })
      .catch(() => undefined);
  }
  // `notifications` is optional: its events exist only once it is granted.
  let listening = false;
  function listenToNotifications(): void {
    if (listening || !browser.notifications) return;
    listening = true;
    browser.notifications.onClicked.addListener((id) => {
      if (id.startsWith('ss|')) void onNotificationClick(id);
    });
    browser.notifications.onButtonClicked.addListener((id, button) => {
      if (id.startsWith('ss|')) void onNotificationClick(id, button);
    });
  }
  listenToNotifications();
  browser.permissions.onAdded.addListener(() => listenToNotifications());

  // First install: add the sample guides so the library is not empty. (Test profiles skip
  // this so tests start from an empty library; they call installSamples through the hook.)
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install' && import.meta.env.MODE !== 'e2e') {
      void installSamples(store).then(() => broadcast({ type: 'library-changed' }));
    }
    void Promise.all([ready, guidanceReady]).then(() => scheduler.startup());
  });

  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
    console.error('ShowSteps: could not set side panel behaviour', error);
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

  /**
   * The guidance script (notes, pins, Guide Me) runs on the sites the user has granted, so pins
   * and notes appear when those pages load. Without website access nothing is registered.
   */
  async function syncGuideScript(): Promise<void> {
    const matches = await grantedOrigins();
    const existing = await browser.scripting.getRegisteredContentScripts({
      ids: [GUIDE_SCRIPT_ID],
    });
    if (!matches.length) {
      if (existing.length)
        await browser.scripting.unregisterContentScripts({ ids: [GUIDE_SCRIPT_ID] });
      return;
    }
    const script = {
      id: GUIDE_SCRIPT_ID,
      js: [GUIDE_SCRIPT_FILE],
      matches,
      allFrames: true,
      runAt: 'document_idle' as const,
    };
    if (existing.length) await browser.scripting.updateContentScripts([script]);
    else
      await browser.scripting.registerContentScripts([{ ...script, persistAcrossSessions: true }]);
  }
  void syncGuideScript().catch(() => undefined);
  browser.permissions.onAdded.addListener(() => void syncGuideScript().catch(() => undefined));
  browser.permissions.onRemoved.addListener(() => void syncGuideScript().catch(() => undefined));

  async function injectGuide(tabId: number): Promise<void> {
    await browser.scripting
      .executeScript({ target: { tabId, allFrames: true }, files: [GUIDE_SCRIPT_FILE] })
      .catch(() => undefined);
  }

  /** Tell every open tab that notes, pins or settings changed. */
  async function notifyTabs(msg: GuideToContent): Promise<void> {
    for (const tab of await browser.tabs.query({})) {
      if (tab.id !== undefined && /^(https?|file):/.test(tab.url ?? ''))
        browser.tabs.sendMessage(tab.id, msg).catch(() => undefined);
    }
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

  /** A scheduled run is going (in its own window): nothing else may record or guide. */
  const scheduledRunGoing = () => guidance.isActive && !!guidance.current.scheduleId;

  async function startCapture(msg: Extract<PageMessage, { type: 'start' }>): Promise<CaptureState> {
    // Recording now would also record the scheduled run's own clicks.
    if (scheduledRunGoing()) throw new Error('busy');
    const tab = await browser.tabs.get(msg.tabId);
    if (!tab.url || !/^(https?|file):/.test(tab.url)) throw new Error('cannot-record-here');
    const allowed = await browser.permissions.contains({ origins: [tab.url] });
    if (!allowed) throw new Error('permission-needed');
    const viewport = await viewportOf(msg.tabId);
    const settings = await readSettings();
    shotQuality = settings.screenshotQuality === 'standard' ? 0.8 : 0.92;
    const state = await recorder.start({
      tabId: msg.tabId,
      url: tab.url,
      ...(tab.title ? { title: tab.title } : {}),
      ...(msg.guideId ? { guideId: msg.guideId } : {}),
      ...(msg.insertAt !== undefined ? { insertAt: msg.insertAt } : {}),
      ...(msg.replaceStepId ? { replaceStepId: msg.replaceStepId } : {}),
      ...(viewport ? { viewport } : {}),
      defaultInputMode: settings.defaultInputMode,
      liveBlur: settings.liveBlurDefault,
      maxZoom: settings.magnify,
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
        // The page hid its toolbar for this picture: taken (or skipped), so release it.
        if (frameId === 0 && msg.uiHidden)
          browser.tabs
            .sendMessage(tabId, { type: 'overlays', visible: true }, { frameId: 0 })
            .catch(() => undefined);
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
            msg.observeId,
          )
          .catch((error: unknown) => console.error('ShowSteps: could not record step', error));
        return { ok: true };
      case 'shot-words':
        if (frameId === 0) recorder.shotWords(msg.shotId, msg.words);
        return { ok: true };
      case 'observe-top':
        browser.tabs
          .sendMessage(tabId, { type: 'observe', observeId: msg.observeId }, { frameId: 0 })
          .catch(() => undefined);
        return { ok: true };
      case 'observed':
        void recorder.observed(msg.observeId, msg.expect);
        return { ok: true };
      case 'control':
        return { state: await recorder.control(msg.action) };
    }
  }

  async function handlePage(msg: PageMessage): Promise<unknown> {
    switch (msg.type) {
      case 'delete-all':
        // Stop what is running, then let go of storage; the page deletes the database.
        if (recorder.isActive) await recorder.control('cancel');
        if (guidance.isActive) await guidance.control('stop');
        await local.close();
        await browser.storage.local.clear();
        await browser.storage.session.clear();
        // Schedules went with local storage; their alarms, logs and screenshots go too.
        await browser.alarms.clearAll();
        await runLogs.close();
        await runFiles.close();
        for (const name of [RUNLOGS_DB, RUNFILES_DB])
          await new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          });
        await attention(false);
        return { ok: true };
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
      case 'delete-step':
        return { state: await recorder.deleteStep(msg.stepId) };
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
        console.error('ShowSteps:', error);
        sendResponse({ error: 'internal' });
      });
      return true;
    };
    const allReady = Promise.all([ready, guidanceReady]);
    if (fromExtensionPage) {
      const parsed = PageMessageSchema.safeParse(raw);
      if (parsed.success) return respond(allReady.then(() => handlePage(parsed.data)));
      const guide = GuidePageMessageSchema.safeParse(raw);
      if (guide.success) return respond(allReady.then(() => handleGuidePage(guide.data)));
      return false;
    }
    if (!sender.tab) return false;
    const parsed = ContentMessageSchema.safeParse(raw);
    if (parsed.success) return respond(allReady.then(() => handleContent(parsed.data, sender)));
    const guide = GuideContentMessageSchema.safeParse(raw);
    if (guide.success) return respond(allReady.then(() => handleGuideContent(guide.data, sender)));
    return false;
  });

  // ---------- Guidance, notes and pins ----------

  // ---------- Guide health (U9) ----------

  /** Where to carry on once a step has been re-captured. */
  let resume: { guideId: string; mode: 'guide' | 'run'; index: number; tabId: number } | undefined;

  /** Guide Me or Run for me could not find the current step: record it again in place. */
  async function recaptureCurrentStep(): Promise<boolean> {
    const st = guidance.current;
    if (st.status !== 'active' || !st.guideId || st.tabId === undefined) return false;
    const guide = await store.getGuide(st.guideId);
    const step = guide ? guideSteps(guide)[st.index] : undefined;
    if (!guide || !step) return false;
    resume = { guideId: guide.id, mode: st.mode, index: st.index, tabId: st.tabId };
    await guidance.control('stop');
    await browser.tabs.update(st.tabId, { active: true });
    await startCapture({
      type: 'start',
      tabId: st.tabId,
      guideId: guide.id,
      replaceStepId: step.id,
    });
    return true;
  }

  /** The re-captured step is in the guide: carry on from the step after it. */
  async function resumeAfterRecapture(guideId: string, added: number): Promise<void> {
    const r = resume;
    resume = undefined;
    if (!r || r.guideId !== guideId) return;
    const guide = await store.getGuide(guideId);
    const total = guide ? guideSteps(guide).length : 0;
    await startGuidance({
      type: 'guide-start',
      guideId,
      mode: r.mode,
      tabId: r.tabId,
      from: Math.min(r.index + Math.max(1, added), Math.max(0, total - 1)),
    }).catch(() => undefined);
  }

  async function startGuidance(
    msg: Extract<GuidePageMessage, { type: 'guide-start' }>,
    options?: StartOptions,
  ) {
    // Starting another session would end the scheduled run.
    if (!options?.scheduleId && scheduledRunGoing()) throw new Error('busy');
    const state = await guidance.start(msg, options);
    if (state.tabId !== undefined) await injectGuide(state.tabId);
    return state;
  }

  async function handleGuidePage(msg: GuidePageMessage): Promise<unknown> {
    switch (msg.type) {
      case 'guide-start':
        try {
          const { fromLink, ...start } = msg;
          return { guidance: await startGuidance(start, fromLink ? { fromLink } : undefined) };
        } catch (error) {
          return {
            guidance: guidance.current,
            error: error instanceof Error ? error.message : 'error',
          };
        }
      case 'guide-control':
        return { guidance: await guidance.control(msg.action) };
      case 'guide-goto':
        return { guidance: await guidance.goto(msg.index) };
      case 'guide-recapture':
        return { ok: await recaptureCurrentStep() };
      case 'guide-selfcheck': {
        const guide = await store.getGuide(msg.guideId);
        if (!guide) return { error: 'not-found' };
        // The dry run's pages need the guidance script even where no guide ran before.
        const checks = await selfCheck(guide, {
          ...pageDeps,
          async waitLoaded(tabId, timeoutMs) {
            await pageDeps.waitLoaded(tabId, timeoutMs);
            await injectGuide(tabId);
          },
        });
        return { checks };
      }
      case 'guide-speed':
        return { guidance: guidance.setSpeed(msg.speed, msg.stepThrough) };
      case 'guide-get':
        return { guidance: guidance.current };
      case 'mark-save': {
        const marks = (await readMarks()).filter((m) => m.id !== msg.mark.id);
        await writeMarks([...marks, msg.mark]);
        broadcast({ type: 'marks-changed' });
        await notifyTabs({ type: 'marks-changed' });
        return { ok: true };
      }
      case 'mark-delete':
        await writeMarks((await readMarks()).filter((m) => m.id !== msg.id));
        broadcast({ type: 'marks-changed' });
        await notifyTabs({ type: 'marks-changed' });
        return { ok: true };
      case 'pick-start':
        await injectGuide(msg.tabId);
        await browser.tabs
          .sendMessage(msg.tabId, { type: 'pick', on: true })
          .catch(() => undefined);
        return { ok: true };
      case 'pick-cancel':
        await browser.tabs
          .sendMessage(msg.tabId, { type: 'pick', on: false })
          .catch(() => undefined);
        return { ok: true };
      case 'settings-changed':
        await notifyTabs({ type: 'marks-changed' });
        void syncDesktop().then(() => broadcast({ type: 'library-changed' }));
        return { ok: true };
      case 'desktop-get': {
        const connected = await syncDesktop();
        return {
          connected,
          // For the Schedule dialog's tip (S4); undefined with desktop app 1.0.
          ...(bridge.can('schedule-wake')
            ? { startWithWindows: bridge.startWithWindows === true }
            : {}),
        };
      }
      case 'schedule-save':
        try {
          return { schedule: await scheduler.save(msg.schedule) };
        } catch (error) {
          return { error: error instanceof Error ? error.message : 'error' };
        }
      case 'schedule-delete':
        await scheduler.remove(msg.id);
        return { ok: true };
      case 'schedule-enable':
        await scheduler.setEnabled(msg.id, msg.enabled);
        return { ok: true };
      case 'schedule-run':
        return await scheduler.startNow(msg.id);
      case 'schedule-seen':
        await scheduler.seen();
        return { ok: true };
      case 'start-link-dismiss':
        await dismissStartLink(msg.tabId);
        return { ok: true };
    }
  }

  async function handleGuideContent(
    msg: GuideContentMessage,
    sender: Browser.runtime.MessageSender,
  ): Promise<unknown> {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return undefined;
    switch (msg.type) {
      case 'guide-hello': {
        const url = sender.url ?? sender.tab?.url ?? '';
        guidance.pageLoaded(tabId, sender.frameId ?? 0, url);
        const settings = await readSettings();
        return { enabled: settings.guidanceEnabled, marks: marksForUrl(await readMarks(), url) };
      }
      case 'guide-done':
        await guidance.stepDone(tabId, msg.stepId);
        return { ok: true };
      case 'guide-control':
        return { guidance: await guidance.control(msg.action) };
      case 'picked': {
        await browser.tabs.sendMessage(tabId, { type: 'pick', on: false }).catch(() => undefined);
        const frameUrl = sender.frameId ? sender.url : undefined;
        broadcast({
          type: 'picked',
          tabId,
          page: pageKey(sender.tab?.url ?? ''),
          ...(frameUrl ? { frameUrl } : {}),
          ...(msg.target ? { target: msg.target } : {}),
          ...(msg.cancelled ? { cancelled: true } : {}),
        });
        return { ok: true };
      }
      case 'open-guide': {
        const windowId = sender.tab?.windowId;
        if (msg.mode === 'view') {
          await browser.tabs.create({
            url: browser.runtime.getURL(
              `/library.html#/guide/${encodeURIComponent(msg.guideId)}/view`,
            ),
            ...(windowId !== undefined ? { windowId } : {}),
          });
          return { ok: true };
        }
        if (windowId !== undefined)
          void browser.sidePanel.open({ windowId }).catch(() => undefined);
        await startGuidance({
          type: 'guide-start',
          guideId: msg.guideId,
          mode: 'guide',
          tabId,
          ...(windowId !== undefined ? { windowId } : {}),
        }).catch(() => undefined);
        return { ok: true };
      }
    }
  }

  // ---------- Desktop app events ----------

  async function activeWebTab(): Promise<Browser.tabs.Tab | undefined> {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.url && /^(https?|file):/.test(tab.url) ? tab : undefined;
  }

  async function onDesktopEvent(event: string, data: unknown): Promise<void> {
    await Promise.all([ready, guidanceReady]);
    const d = (data ?? {}) as Record<string, unknown>;
    switch (event) {
      case 'capture-request': {
        const action = String(d.action ?? '');
        if (action === 'start' && !recorder.isActive) {
          const tab = await activeWebTab();
          if (tab?.id !== undefined)
            await startCapture({ type: 'start', tabId: tab.id }).catch(() => undefined);
          else bridge.sendEvent('capture-state', recorder.current);
        } else if (action === 'finish' || action === 'cancel' || action === 'delete-last') {
          await recorder.control(action);
        }
        break;
      }
      case 'desktop-event':
        await recorder.desktopEvent(d.event as CaptureEvent, d.shot as DesktopShot | undefined);
        break;
      case 'guide-start': {
        const tab = await activeWebTab();
        await startGuidance({
          type: 'guide-start',
          guideId: String(d.guideId ?? ''),
          mode: 'guide',
          ...(tab?.id !== undefined ? { tabId: tab.id } : {}),
          ...(tab?.windowId !== undefined ? { windowId: tab.windowId } : {}),
        }).catch(() => undefined);
        break;
      }
      case 'desktop-step-done':
        await guidance.desktopDone(String(d.stepId ?? ''));
        break;
      case 'library-changed':
        broadcast({ type: 'library-changed' });
        break;
    }
  }

  void syncDesktop();

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
    else void recorder.pageChanged(d.tabId, d.url);
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

  browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
    void guidanceReady.then(() => guidance.tabActivated(tabId, windowId));
    void ready.then(() => {
      if (!recorder.isActive) return;
      // Typing in the tab the user left has no "change" event yet: collect it from every frame
      // of the other tabs, in order, before anything recorded in the new tab.
      const others = recorder.trackedTabs.filter((t) => t !== tabId);
      if (others.length) void recorder.flush(() => collectPendingTyping(others));
      void injectInto(tabId);
    });
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    frames.forgetTab(tabId);
    void guidanceReady.then(() => guidance.tabClosed(tabId));
  });

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
    Object.assign(globalThis, {
      __showsteps: {
        recorder,
        store,
        startCapture,
        installSamples: () => installSamples(store),
        guidance,
        startGuidance,
        readMarks,
        syncDesktop,
        scheduler,
        runLogs,
        runFiles,
        schedulesKey: SCHEDULES_KEY,
        guideVersion,
      },
    });
  }
});
