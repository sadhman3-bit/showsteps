import { RunLogSchema, runLogsToDrop, type RunLog } from '@showsteps/core';

/** Scheduled runs' logs and their step screenshots: this browser profile only, never synced. */
export const RUNLOGS_DB = 'showsteps-runlogs';
const LOGS = 'runlogs';
const SHOTS = 'shots';

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

export class RunLogStore {
  private db: Promise<IDBDatabase> | undefined;

  constructor(private readonly idb: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.idb.open(RUNLOGS_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore(LOGS, { keyPath: 'id' }).createIndex('scheduleId', 'scheduleId');
        db.createObjectStore(SHOTS);
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

  async put(log: RunLog): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(LOGS, 'readwrite');
    tx.objectStore(LOGS).put(RunLogSchema.parse(log));
    await finished(tx);
  }

  async get(id: string): Promise<RunLog | undefined> {
    const db = await this.open();
    const raw: unknown = await done(db.transaction(LOGS).objectStore(LOGS).get(id));
    const parsed = RunLogSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  /** A schedule's runs, newest first. */
  async list(scheduleId: string): Promise<RunLog[]> {
    const db = await this.open();
    const raw: unknown[] = await done(
      db.transaction(LOGS).objectStore(LOGS).index('scheduleId').getAll(scheduleId),
    );
    return raw
      .flatMap((r) => {
        const p = RunLogSchema.safeParse(r);
        return p.success ? [p.data] : [];
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async putShot(name: string, blob: Blob): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(SHOTS, 'readwrite');
    tx.objectStore(SHOTS).put(blob, name);
    await finished(tx);
  }

  async getShot(name: string): Promise<Blob | undefined> {
    const db = await this.open();
    const raw: unknown = await done(db.transaction(SHOTS).objectStore(SHOTS).get(name));
    return raw instanceof Blob ? raw : undefined;
  }

  /** Delete runs and their screenshots. */
  async remove(logs: readonly RunLog[]): Promise<void> {
    if (!logs.length) return;
    const db = await this.open();
    const tx = db.transaction([LOGS, SHOTS], 'readwrite');
    for (const log of logs) {
      tx.objectStore(LOGS).delete(log.id);
      for (const step of log.steps)
        if (step.screenshot) tx.objectStore(SHOTS).delete(step.screenshot);
    }
    await finished(tx);
  }

  /** Keep the newest runs of a schedule (`MAX_RUN_LOGS`). */
  async trim(scheduleId: string): Promise<void> {
    const logs = await this.list(scheduleId);
    const drop = new Set(runLogsToDrop(logs));
    await this.remove(logs.filter((l) => drop.has(l.id)));
  }

  async removeSchedule(scheduleId: string): Promise<void> {
    await this.remove(await this.list(scheduleId));
  }
}
