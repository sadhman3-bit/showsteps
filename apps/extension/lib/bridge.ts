// The extension's side of the desktop bridge: Chrome native messaging to trailmark-host.exe,
// which relays to the Trailmark desktop app. Used by the service worker (capture, guidance) and
// by pages (the library, when guides live in the desktop library).
import {
  BRIDGE_HOST,
  BRIDGE_STORE_METHODS,
  PartCollector,
  decodeMessage,
  encodeMessage,
  type BridgePart,
  type BridgeReply,
  type GuideStore,
} from '@trailmark/core';

type Status = 'off' | 'connecting' | 'connected' | 'offline';

const isPart = (m: unknown): m is BridgePart =>
  !!m && typeof m === 'object' && 'part' in m && 'of' in m && 'text' in m;

/** One native messaging connection, with request/reply and events. */
export class BridgeClient {
  private port: Browser.runtime.Port | undefined;
  private next = 0;
  private status: Status = 'off';
  private readonly waiting = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly parts = new PartCollector();
  private connecting: Promise<boolean> | undefined;

  constructor(
    private readonly role: 'background' | 'page',
    private readonly onEvent: (event: string, data: unknown) => void = () => undefined,
    private readonly onStatus: (connected: boolean) => void = () => undefined,
  ) {}

  get connected(): boolean {
    return this.status === 'connected';
  }

  /** Connect (once at a time). Resolves false when the desktop app is not running or missing. */
  connect(): Promise<boolean> {
    if (this.status === 'connected') return Promise.resolve(true);
    this.connecting ??= this.open().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  private async open(): Promise<boolean> {
    this.status = 'connecting';
    let port: Browser.runtime.Port;
    try {
      port = browser.runtime.connectNative(BRIDGE_HOST);
    } catch {
      this.status = 'offline';
      return false;
    }
    this.port = port;
    const gone = new Promise<false>((resolve) =>
      port.onDisconnect.addListener(() => {
        this.drop();
        resolve(false);
      }),
    );
    port.onMessage.addListener((raw: unknown) => this.receive(raw));
    const hello = this.call('hello', [{ role: this.role }]).then(
      () => true,
      () => false,
    );
    const ok = await Promise.race([hello, gone]);
    if (ok) {
      this.status = 'connected';
      this.onStatus(true);
    } else {
      this.disconnect();
    }
    return ok;
  }

  private drop(): void {
    const was = this.status === 'connected';
    this.status = 'offline';
    this.port = undefined;
    for (const w of this.waiting.values()) w.reject(new Error('bridge closed'));
    this.waiting.clear();
    if (was) this.onStatus(false);
  }

  disconnect(): void {
    this.port?.disconnect();
    this.drop();
  }

  private receive(raw: unknown): void {
    let msg: unknown;
    if (isPart(raw)) {
      const whole = this.parts.add(raw);
      if (whole === undefined) return;
      msg = decodeMessage(whole);
    } else {
      // Chrome already parsed the JSON; bytes still need restoring.
      msg = decodeMessage(JSON.stringify(raw));
    }
    if (!msg || typeof msg !== 'object') return;
    if ((msg as { type?: string }).type === 'offline') {
      this.disconnect();
      return;
    }
    if ('event' in msg) {
      const ev = msg as { event: string; data?: unknown };
      this.onEvent(ev.event, ev.data);
      return;
    }
    const reply = msg as BridgeReply;
    const w = this.waiting.get(reply.id);
    if (!w) return;
    this.waiting.delete(reply.id);
    if (reply.ok) w.resolve(reply.result);
    else w.reject(new Error(reply.error ?? 'bridge error'));
  }

  private post(message: unknown): void {
    // Bytes are encoded first: Chrome would otherwise turn a Uint8Array into an object of indexes.
    this.port?.postMessage(JSON.parse(encodeMessage(message)) as object);
  }

  call<T = unknown>(method: string, args: unknown[] = []): Promise<T> {
    const port = this.port;
    if (!port) return Promise.reject(new Error('bridge not connected'));
    const id = ++this.next;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: (v) => resolve(v as T), reject });
      this.post({ id, method, args });
    });
  }

  sendEvent(event: string, data?: unknown): void {
    if (this.status === 'connected') this.post({ event, data });
  }
}

/** The desktop library as a GuideStore, through the bridge. */
export function bridgeStore(client: BridgeClient): GuideStore {
  const store: Record<string, unknown> = { kind: 'folder' };
  for (const method of BRIDGE_STORE_METHODS) {
    store[method] = async (...args: unknown[]) => {
      await client.connect();
      return client.call(`store.${method}`, args);
    };
  }
  return store as unknown as GuideStore;
}

/**
 * A GuideStore that forwards each call to whichever library is current (browser storage, or the
 * desktop library through the bridge); `current` is asked on every call.
 */
export function switchableStore(
  current: () => Promise<GuideStore>,
  kind: () => GuideStore['kind'],
): GuideStore {
  const store: Record<string, unknown> = {};
  Object.defineProperty(store, 'kind', { get: kind });
  for (const method of BRIDGE_STORE_METHODS) {
    store[method] = async (...args: unknown[]) => {
      const target = (await current()) as unknown as Record<
        string,
        (...a: unknown[]) => Promise<unknown>
      >;
      return target[method]?.(...args);
    };
  }
  return store as unknown as GuideStore;
}

/** Copy every guide (with pictures, versions excluded, and sidecars) into another library. */
export async function copyLibrary(
  from: GuideStore,
  to: GuideStore,
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<number> {
  for (const folder of await from.listFolders()) await to.saveFolder(folder);
  const list = await from.listGuides();
  let done = 0;
  for (const summary of list) {
    const guide = await from.getGuide(summary.id);
    if (!guide) continue;
    for (const name of await from.listImages(guide.id)) {
      const bytes = await from.getImage(guide.id, name);
      if (bytes) await to.putImage(guide.id, name, bytes);
    }
    for (const kind of ['comments', 'analytics'] as const) {
      for (const { user, data } of await from.listSidecars(guide.id, kind)) {
        await to.writeSidecar(guide.id, kind, user, data);
      }
    }
    await to.saveGuide(guide);
    onProgress(++done, list.length);
  }
  return done;
}
