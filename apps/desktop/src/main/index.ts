import { BRIDGE_STORE_METHODS, FolderStore, parseGuide, type GuideStore } from '@trailmark/core';
import { nodeFileSystem } from '@trailmark/core/node';
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
} from 'electron';
import { mkdirSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BridgeServer } from './bridge';
import { DesktopGuide, type OverlayView } from './guide';
import { UiaHelper } from './helper';
import { registerNativeHost, unregisterNativeHost } from './nativeHost';
import {
  DesktopRecorder,
  LibrarySink,
  type DesktopCaptureState,
  type DesktopShot,
} from './recorder';
import {
  DesktopSettingsSchema,
  defaultSettings,
  loadSettings,
  saveSettings,
  type DesktopSettings,
} from './settings';
import { ExtensionSink } from './sinks';

const SHORTCUT = 'Control+Alt+R';
const E2E = process.env.TRAILMARK_E2E === '1';

/** Installer hooks: register or remove the browser bridge for this user, then exit. */
const hostSetup = process.argv.includes('--register-native-host')
  ? 'register'
  : process.argv.includes('--unregister-native-host')
    ? 'unregister'
    : undefined;

if (!hostSetup && !app.requestSingleInstanceLock()) app.quit();

// ---------- Paths ----------

const resources = app.isPackaged ? process.resourcesPath : join(__dirname, '..', '..', 'resources');
const helperExe = join(resources, 'bin', 'uia-helper.exe');
const hostExe = join(resources, 'bin', 'trailmark-host.exe');
const renderer = join(__dirname, '..', 'renderer');
const icon = join(resources, 'icon.png');
if (process.env.TRAILMARK_USER_DATA) app.setPath('userData', process.env.TRAILMARK_USER_DATA);
const settingsFile = () => join(app.getPath('userData'), 'settings.json');
const shotDir = () => join(app.getPath('temp'), 'trailmark-shots');

// ---------- State ----------

let settings: DesktopSettings;
let personal: GuideStore;
let shared: GuideStore | undefined;
let mainWindow: BrowserWindow | undefined;
let controller: BrowserWindow | undefined;
let overlay: BrowserWindow | undefined;
let tray: Tray | undefined;

const helper = new UiaHelper(helperExe);

function openStores(): void {
  personal = new FolderStore(nodeFileSystem, settings.libraryPath, { user: settings.userName });
  shared = settings.sharedPath
    ? new FolderStore(nodeFileSystem, settings.sharedPath, { user: settings.userName })
    : undefined;
}

/** The library shown in the window and used for new captures. */
function activeStore(): GuideStore {
  return settings.active === 'shared' && shared ? shared : personal;
}

function broadcast(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows())
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

// ---------- Bridge ----------

const bridge = new BridgeServer(activeStore, () => ({
  user: settings.userName,
  library: settings.active === 'shared' && shared ? settings.sharedPath : settings.libraryPath,
}));

// ---------- Capture ----------

async function readShot(path: string, scale: number): Promise<DesktopShot> {
  const full = new Uint8Array(await readFile(path));
  const image = nativeImage.createFromBuffer(Buffer.from(full));
  const { width, height } = image.getSize();
  const thumb = new Uint8Array(image.resize({ width: 320, quality: 'good' }).toPNG());
  void rm(path, { force: true });
  return { full, thumb, width, height, scale };
}

function ownPids(): number[] {
  return [process.pid, ...app.getAppMetrics().map((m) => m.pid)];
}

const recorder = new DesktopRecorder({
  helper,
  readShot,
  ownPids,
  shotDir: shotDir(),
  onState: (state) => {
    broadcast('capture-state', state);
    updateController(state);
    updateTray();
  },
});

let extensionCapture: { status: string; stepCount: number } = { status: 'idle', stepCount: 0 };

async function startCapture(): Promise<void> {
  if (recorder.isActive) return;
  if (bridge.extensionConnected && extensionCapture.status !== 'idle') {
    await recorder.start(new ExtensionSink(bridge), true);
    return;
  }
  const sink = new LibrarySink(
    activeStore(),
    `Desktop process ${new Date().toLocaleString()}`,
    settings.defaultInputMode,
  );
  await recorder.start(sink, false);
}

async function finishCapture(): Promise<void> {
  const id = await recorder.finish();
  broadcast('library-changed');
  if (id) showMain(`#/guide/${encodeURIComponent(id)}`);
}

function updateController(state: DesktopCaptureState): void {
  if (state.status === 'idle') {
    controller?.hide();
    void cleanShots();
    return;
  }
  if (!controller || controller.isDestroyed()) {
    const area = screen.getPrimaryDisplay().workArea;
    controller = new BrowserWindow({
      width: 360,
      height: 56,
      x: area.x + area.width - 380,
      y: area.y + area.height - 76,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      show: false,
      webPreferences: { preload: join(__dirname, '..', 'preload', 'index.cjs'), sandbox: true },
    });
    controller.setContentProtection(true); // never in a screenshot
    controller.setAlwaysOnTop(true, 'screen-saver');
    void controller.loadFile(join(renderer, 'controller.html'));
    controller.once('ready-to-show', () => controller?.showInactive());
  } else if (!controller.isVisible()) controller.showInactive();
}

async function cleanShots(): Promise<void> {
  if (recorder.isActive || guide.active) return;
  const dir = shotDir();
  for (const f of await readdir(dir).catch(() => [])) await rm(join(dir, f), { force: true });
}

// ---------- Desktop Guide Me (G8) ----------

function overlayHost() {
  return {
    show(view: OverlayView) {
      const point = view.rect
        ? screen.screenToDipPoint({ x: view.rect.x, y: view.rect.y })
        : screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(point);
      if (!overlay || overlay.isDestroyed()) {
        overlay = new BrowserWindow({
          ...display.bounds,
          frame: false,
          transparent: true,
          resizable: false,
          movable: false,
          focusable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          hasShadow: false,
          show: false,
          webPreferences: { preload: join(__dirname, '..', 'preload', 'index.cjs'), sandbox: true },
        });
        overlay.setAlwaysOnTop(true, 'screen-saver');
        overlay.setContentProtection(true);
        overlay.setIgnoreMouseEvents(true, { forward: true });
        void overlay.loadFile(join(renderer, 'overlay.html'));
      }
      overlay.setBounds(display.bounds);
      const ring = view.rect
        ? (() => {
            const dip = screen.screenToDipRect(null, {
              x: view.rect.x,
              y: view.rect.y,
              width: view.rect.w,
              height: view.rect.h,
            });
            return {
              x: dip.x - display.bounds.x,
              y: dip.y - display.bounds.y,
              w: dip.width,
              h: dip.height,
            };
          })()
        : undefined;
      const payload = { ...view, ...(ring ? { ring } : {}) };
      const send = () => overlay?.webContents.send('overlay', payload);
      if (overlay.webContents.isLoading()) overlay.webContents.once('did-finish-load', send);
      else send();
      overlay.showInactive();
    },
    hide() {
      overlay?.hide();
    },
  };
}

const guide = new DesktopGuide(helper, overlayHost(), async (on) => {
  if (recorder.isActive) return; // capture already has the hooks
  await helper.hook(on, { dir: shotDir(), ignorePids: ownPids() }).catch(() => undefined);
  if (!on) await cleanShots();
});
guide.on('done', (stepId) => bridge.sendEvent('desktop-step-done', { stepId }));
guide.on('state', (s) => broadcast('guide-state', s));

/** Guide Me from this app: the extension conducts guides with web steps when it is connected. */
async function startGuide(guideId: string): Promise<void> {
  const g = await activeStore().getGuide(guideId);
  if (!g) return;
  const hasWeb = g.blocks.some((b) => b.kind === 'step' && b.app.kind === 'web');
  if (hasWeb && bridge.extensionConnected) {
    bridge.sendEvent('guide-start', { guideId });
    return;
  }
  await guide.start(activeStore(), guideId);
}

// ---------- Bridge events ----------

bridge.on('event', (name, data) => {
  const d = (data ?? {}) as Record<string, unknown>;
  switch (name) {
    case 'capture-state': {
      // The extension started or finished a capture: desktop steps join it.
      const status = String(d.status ?? 'idle');
      extensionCapture = { status, stepCount: Number(d.stepCount ?? 0) };
      if (status !== 'idle' && !recorder.isActive)
        void recorder.start(new ExtensionSink(bridge), true);
      if (status === 'idle' && recorder.current.shared)
        void recorder.finish().then(() => broadcast('library-changed'));
      break;
    }
    case 'library-changed':
      broadcast('library-changed');
      break;
    case 'desktop-step': {
      const step = parseGuideStep(d.step);
      if (step) void guide.showStep(step, Number(d.number ?? 1), Number(d.total ?? 1));
      break;
    }
    case 'desktop-step-clear':
      void guide.stop();
      break;
  }
});
bridge.on('connected', (on) => broadcast('bridge-state', { connected: on }));

function parseGuideStep(raw: unknown) {
  try {
    const g = parseGuide({
      id: 'x',
      schemaVersion: 1,
      title: '',
      tags: [],
      createdAt: '',
      updatedAt: '',
      preconditions: [],
      apps: [],
      variables: [],
      blocks: [raw],
      settings: { defaultInputMode: 'fixed' },
    });
    const b = g.blocks[0];
    return b?.kind === 'step' ? b : undefined;
  } catch {
    return undefined;
  }
}

// ---------- Windows ----------

function showMain(hash = ''): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      title: 'ABCXYZ',
      icon,
      show: false,
      webPreferences: { preload: join(__dirname, '..', 'preload', 'index.cjs'), sandbox: true },
    });
    mainWindow.setContentProtection(true);
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    void mainWindow.loadFile(join(renderer, 'index.html'), hash ? { hash: hash.slice(1) } : {});
    mainWindow.on('close', (e) => {
      // Closing the window keeps ABCXYZ in the tray (the shortcut still works).
      if (!quitting) {
        e.preventDefault();
        mainWindow?.hide();
      }
    });
  } else {
    if (hash) void mainWindow.loadFile(join(renderer, 'index.html'), { hash: hash.slice(1) });
    mainWindow.show();
    mainWindow.focus();
  }
}

let quitting = false;

function updateTray(): void {
  if (!tray) return;
  const recording = recorder.isActive;
  tray.setToolTip(recording ? 'ABCXYZ: recording' : 'ABCXYZ');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open ABCXYZ', click: () => showMain() },
      recording
        ? { label: 'Finish capture', click: () => void finishCapture() }
        : { label: `Start capture (Ctrl+Alt+R)`, click: () => void startCapture() },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// ---------- IPC ----------

const STORE_METHODS = new Set<string>(BRIDGE_STORE_METHODS);

function registerIpc(): void {
  ipcMain.handle('store', async (_e, which: unknown, method: unknown, args: unknown) => {
    if (typeof method !== 'string' || !STORE_METHODS.has(method) || !Array.isArray(args)) {
      throw new Error('invalid store call');
    }
    const store =
      which === 'shared' && shared ? shared : which === 'personal' ? personal : activeStore();
    const fn = (store as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
    const result = await fn?.apply(store, args);
    if (/^(save|trash|restore|purge|put|delete)/.test(method)) bridge.sendEvent('library-changed');
    return result;
  });
  ipcMain.handle('settings:get', () => ({ ...settings, sharedAvailable: !!shared }));
  ipcMain.handle('settings:set', async (_e, value: unknown) => {
    const next = DesktopSettingsSchema.parse({
      ...settings,
      ...DesktopSettingsSchema.partial().parse(value),
    });
    await saveSettings(settingsFile(), next);
    settings = next;
    openStores();
    broadcast('library-changed');
    return { ...settings, sharedAvailable: !!shared };
  });
  ipcMain.handle('pick-folder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? undefined : r.filePaths[0];
  });
  ipcMain.handle('capture:start', () => startCapture());
  ipcMain.handle('capture:control', async (_e, action: unknown) => {
    if (action === 'finish') await finishCapture();
    else if (action === 'cancel') await recorder.cancel();
    else if (action === 'pause') recorder.pause();
    else if (action === 'resume') recorder.resume();
    else if (action === 'delete-last') await recorder.deleteLast();
    return recorder.current;
  });
  ipcMain.handle('capture:state', () => recorder.current);
  ipcMain.handle('bridge:state', () => ({ connected: bridge.extensionConnected }));
  ipcMain.handle('guide:start', (_e, guideId: unknown) => {
    if (typeof guideId === 'string') return startGuide(guideId);
    return undefined;
  });
  ipcMain.handle('overlay:control', (_e, action: unknown) => {
    if (action === 'next' || action === 'back' || action === 'stop') return guide.control(action);
    return undefined;
  });
  ipcMain.on('overlay:interactive', (_e, on: unknown) => {
    overlay?.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.handle('open-external', (_e, url: unknown) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) return shell.openExternal(url);
    return undefined;
  });
}

// ---------- Start ----------

void app.whenReady().then(async () => {
  if (hostSetup) {
    if (hostSetup === 'register')
      await registerNativeHost(app.getPath('userData'), hostExe).catch(() => undefined);
    else await unregisterNativeHost(app.getPath('userData')).catch(() => undefined);
    app.exit(0);
    return;
  }
  settings = await loadSettings(settingsFile(), {
    ...defaultSettings(app.getPath('documents')),
    ...(process.env.TRAILMARK_LIBRARY ? { libraryPath: process.env.TRAILMARK_LIBRARY } : {}),
  });
  if (process.env.TRAILMARK_LIBRARY) settings.libraryPath = process.env.TRAILMARK_LIBRARY;
  mkdirSync(settings.libraryPath, { recursive: true });
  mkdirSync(shotDir(), { recursive: true });
  openStores();
  registerIpc();

  // Exports save straight to Downloads (the renderer uses download links).
  session.defaultSession.on('will-download', (_e, item) => {
    item.setSavePath(
      join(process.env.TRAILMARK_DOWNLOADS ?? app.getPath('downloads'), item.getFilename()),
    );
  });

  await registerNativeHost(app.getPath('userData'), hostExe).catch(() => undefined);
  await bridge
    .listen()
    .catch((error: unknown) => console.error('ABCXYZ: bridge unavailable', error));

  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }));
  tray.on('click', () => showMain());
  updateTray();
  globalShortcut.register(SHORTCUT, () => {
    if (recorder.isActive) void finishCapture();
    else void startCapture();
  });
  if (!process.argv.includes('--hidden')) showMain();
});

app.on('second-instance', () => showMain());
app.on('window-all-closed', () => undefined); // stays in the tray
app.on('before-quit', () => {
  quitting = true;
  globalShortcut.unregisterAll();
  bridge.close();
  helper.stop();
});

if (E2E) {
  // Test hook for Playwright's Electron tests; only set when TRAILMARK_E2E=1.
  Object.assign(globalThis, {
    __trailmarkDesktop: {
      helper,
      recorder,
      guide,
      bridge,
      startCapture,
      finishCapture,
      startGuide,
      store: () => activeStore(),
    },
  });
}
