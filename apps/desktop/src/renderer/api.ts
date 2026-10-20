import type { InputMode } from '@showsteps/core';
import { BRIDGE_STORE_METHODS, type GuideStore } from '@showsteps/core';
import { useEffect, useState } from 'preact/hooks';

interface DesktopApi {
  store(which: string, method: string, args: unknown[]): Promise<unknown>;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
  overlayInteractive(on: boolean): void;
}

declare global {
  interface Window {
    showsteps: DesktopApi;
  }
}

export const api = (): DesktopApi => window.showsteps;

/**
 * The desktop library as a GuideStore: every call goes to the main process, which owns the
 * folders on disk. `which` picks the personal or team library ("active" follows Settings).
 */
export function ipcStore(which: 'active' | 'personal' | 'shared' = 'active'): GuideStore {
  const store: Record<string, unknown> = { kind: 'folder' };
  for (const method of BRIDGE_STORE_METHODS) {
    store[method] = (...args: unknown[]) => api().store(which, method, args);
  }
  return store as unknown as GuideStore;
}

export interface DesktopSettingsView {
  userName: string;
  guidanceEnabled: boolean;
  aiEnabled: boolean;
  libraryPath: string;
  sharedPath: string;
  active: 'personal' | 'shared';
  sharedAvailable: boolean;
  defaultInputMode: InputMode;
  theme: 'system' | 'light' | 'dark';
  startWithWindows: boolean;
}

export interface CaptureView {
  status: 'idle' | 'recording' | 'paused';
  stepCount: number;
  shared: boolean;
  lastGuideId?: string;
}

/** A value pushed from the main process, with its first value fetched on mount. */
export function usePushed<T>(channel: string, initial: T, fetch?: () => Promise<unknown>): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    void fetch?.().then((v) => v !== undefined && setValue(v as T));
    return api().on(channel, (v) => setValue(v as T));
  }, [channel]);
  return value;
}

/** Bumped whenever the library changes (capture finished, the extension saved). */
export function useLibraryVersion(): number {
  const [n, setN] = useState(0);
  useEffect(() => api().on('library-changed', () => setN((v) => v + 1)), []);
  return n;
}
