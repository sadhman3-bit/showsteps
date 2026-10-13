import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// The only door between ABCXYZ's pages and the main process: named channels, no Node.
const INVOKE = new Set([
  'settings:get',
  'settings:set',
  'pick-folder',
  'capture:start',
  'capture:control',
  'capture:state',
  'bridge:state',
  'guide:start',
  'overlay:control',
  'open-external',
]);
const EVENTS = new Set([
  'capture-state',
  'library-changed',
  'bridge-state',
  'guide-state',
  'overlay',
]);

contextBridge.exposeInMainWorld('trailmark', {
  store: (which: string, method: string, args: unknown[]) =>
    ipcRenderer.invoke('store', which, method, args),
  invoke: (channel: string, ...args: unknown[]) => {
    if (!INVOKE.has(channel)) return Promise.reject(new Error(`blocked channel ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: string, listener: (payload: unknown) => void) => {
    if (!EVENTS.has(channel)) return () => undefined;
    const handler = (_e: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  overlayInteractive: (on: boolean) => ipcRenderer.send('overlay:interactive', on),
});
