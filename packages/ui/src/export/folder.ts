/**
 * "Save to shared folder" for the browser: the File System Access API writes straight into a
 * folder the user picks (for example a OneDrive or SharePoint-synced folder). The folder handle
 * is remembered in IndexedDB so later saves overwrite the same files.
 */

interface PermissionAware {
  queryPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
}

type FolderHandle = FileSystemDirectoryHandle & PermissionAware;

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: 'readwrite' }) => Promise<FolderHandle>;
  }
}

const DB = 'trailmark-ui';
const STORE = 'handles';
const KEY = 'sharedFolder';

function withStore<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error ?? new Error('IndexedDB unavailable'));
    open.onsuccess = () => {
      const db = open.result;
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => {
        resolve(req.result);
        db.close();
      };
      req.onerror = () => {
        reject(req.error ?? new Error('IndexedDB request failed'));
        db.close();
      };
    };
  });
}

export function canPickFolder(): boolean {
  return typeof window.showDirectoryPicker === 'function';
}

/** The remembered folder, if any. */
export async function rememberedFolder(): Promise<FolderHandle | undefined> {
  try {
    return (await withStore<FolderHandle | undefined>('readonly', (s) => s.get(KEY))) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Ask for a folder and remember it. Returns undefined if the user cancels. */
export async function pickFolder(): Promise<FolderHandle | undefined> {
  if (!window.showDirectoryPicker) return undefined;
  try {
    const handle = await window.showDirectoryPicker({ id: 'showsteps-shared', mode: 'readwrite' });
    await withStore('readwrite', (s) => s.put(handle, KEY));
    return handle;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return undefined;
    throw err;
  }
}

/** Make sure we may still write there (Chrome asks again after a restart). */
async function writable(handle: FolderHandle): Promise<boolean> {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

/** Write (or overwrite) files in the folder. */
export async function saveFiles(
  handle: FolderHandle,
  files: { name: string; bytes: Uint8Array }[],
): Promise<boolean> {
  if (!(await writable(handle))) return false;
  for (const f of files) {
    const file = await handle.getFileHandle(f.name, { create: true });
    const out = await file.createWritable();
    await out.write(f.bytes as BufferSource);
    await out.close();
  }
  return true;
}
