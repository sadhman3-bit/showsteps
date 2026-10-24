/**
 * Files a Run for me run downloaded and will attach to a later upload step (1.2): kept in this
 * browser profile only, for that run only, and deleted when it ends. Never written anywhere else.
 */
export const RUNFILES_DB = 'showsteps-run-files';
const FILES = 'files';

/** At most this much per file and per run. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_RUN_BYTES = 50 * 1024 * 1024;

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexeddb'));
  });

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexeddb'));
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });

interface Stored {
  runId: string;
  stepId: string;
  blob: Blob;
}

export class RunFileStore {
  private db: Promise<IDBDatabase> | undefined;

  constructor(private readonly idb: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.idb.open(RUNFILES_DB, 1);
      req.onupgradeneeded = () => {
        req.result
          .createObjectStore(FILES, { keyPath: ['runId', 'stepId'] })
          .createIndex('runId', 'runId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexeddb'));
    });
    return this.db;
  }

  /** Close the connection (before the database is deleted). */
  async close(): Promise<void> {
    const db = this.db;
    this.db = undefined;
    if (db) (await db.catch(() => undefined))?.close();
  }

  async put(runId: string, stepId: string, blob: Blob): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(FILES, 'readwrite');
    tx.objectStore(FILES).put({ runId, stepId, blob } satisfies Stored);
    await finished(tx);
  }

  async get(runId: string, stepId: string): Promise<Blob | undefined> {
    const db = await this.open();
    const raw = (await done(db.transaction(FILES).objectStore(FILES).get([runId, stepId]))) as
      Stored | undefined;
    return raw?.blob instanceof Blob ? raw.blob : undefined;
  }

  /** Delete one run's files. */
  async deleteRun(runId: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(FILES, 'readwrite');
    const store = tx.objectStore(FILES);
    for (const key of await done(store.index('runId').getAllKeys(runId))) store.delete(key);
    await finished(tx);
  }

  /** At start-up: delete every file not belonging to the run still going (if any). */
  async deleteExcept(runId: string | undefined): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(FILES, 'readwrite');
    const store = tx.objectStore(FILES);
    for (const key of await done(store.getAllKeys()))
      if (!Array.isArray(key) || key[0] !== runId) store.delete(key);
    await finished(tx);
  }

  /** How many files are kept (tests). */
  async count(): Promise<number> {
    const db = await this.open();
    return done(db.transaction(FILES).objectStore(FILES).count());
  }
}
