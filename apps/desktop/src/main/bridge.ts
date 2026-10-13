import {
  BRIDGE_STORE_METHODS,
  BRIDGE_VERSION,
  decodeMessage,
  encodeMessage,
  splitMessage,
  type BridgeEvent,
  type BridgeReply,
  type BridgeRequest,
  type GuideStore,
} from '@showsteps/core';
import { EventEmitter } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import { userInfo } from 'node:os';
import { createInterface } from 'node:readline';

/** The pipe showsteps-host.exe connects to (one per Windows user). */
export function pipePath(user = userInfo().username): string {
  return `\\\\.\\pipe\\showsteps-${user.toLowerCase()}`;
}

interface Client {
  socket: Socket;
  /** The extension's service worker (as opposed to one of its pages). */
  background: boolean;
}

const STORE = new Set<string>(BRIDGE_STORE_METHODS);

/**
 * The desktop end of the extension bridge. Each connection is one extension context (its
 * service worker, the library or the side panel) relayed by showsteps-host.exe. Requests are
 * answered from the desktop library; events go both ways.
 */
export class BridgeServer extends EventEmitter<{
  event: [name: string, data: unknown];
  connected: [background: boolean];
}> {
  private server: Server | undefined;
  private readonly clients = new Set<Client>();
  /** Ids for event messages (negative, so their parts never mix with replies). */
  private eventSeq = 0;

  constructor(
    private readonly store: () => GuideStore,
    private readonly info: () => { user: string; library: string },
  ) {
    super();
  }

  get extensionConnected(): boolean {
    return [...this.clients].some((c) => c.background);
  }

  listen(path = pipePath()): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => this.accept(socket));
      this.server.once('error', reject);
      this.server.listen(path, () => resolve());
    });
  }

  close(): void {
    for (const c of this.clients) c.socket.destroy();
    this.server?.close();
  }

  private accept(socket: Socket): void {
    const client: Client = { socket, background: false };
    this.clients.add(client);
    socket.setEncoding('utf8');
    socket.on('error', () => undefined);
    socket.on('close', () => {
      this.clients.delete(client);
      if (client.background) this.emit('connected', this.extensionConnected);
    });
    createInterface({ input: socket }).on('line', (line) => {
      void this.onLine(client, line);
    });
  }

  private send(client: Client, message: unknown, id = 0): void {
    for (const part of splitMessage(id, encodeMessage(message))) {
      if (!client.socket.destroyed) client.socket.write(`${part}\n`);
    }
  }

  /** Tell the extension's service worker something (capture and guidance events). */
  sendEvent(event: string, data?: unknown): boolean {
    let sent = false;
    for (const c of this.clients) {
      if (!c.background) continue;
      this.send(c, { event, data } satisfies BridgeEvent, -++this.eventSeq);
      sent = true;
    }
    return sent;
  }

  private async onLine(client: Client, line: string): Promise<void> {
    let msg: BridgeRequest | BridgeEvent;
    try {
      msg = decodeMessage(line);
    } catch {
      return;
    }
    if ('event' in msg) {
      this.emit('event', msg.event, msg.data);
      return;
    }
    if (typeof msg.id !== 'number' || typeof msg.method !== 'string' || !Array.isArray(msg.args))
      return;
    const reply: BridgeReply = { id: msg.id, ok: true };
    try {
      reply.result = await this.handle(client, msg);
    } catch (error) {
      reply.ok = false;
      reply.error = error instanceof Error ? error.message : 'error';
    }
    this.send(client, reply, msg.id);
  }

  private async handle(client: Client, msg: BridgeRequest): Promise<unknown> {
    if (msg.method === 'hello') {
      const role = (msg.args[0] as { role?: string } | undefined)?.role;
      if (role === 'background') {
        client.background = true;
        this.emit('connected', true);
      }
      return { version: BRIDGE_VERSION, ...this.info() };
    }
    if (msg.method.startsWith('store.')) {
      const method = msg.method.slice(6);
      if (!STORE.has(method)) throw new Error(`unknown method ${method}`);
      const store = this.store() as unknown as Record<
        string,
        (...a: unknown[]) => Promise<unknown>
      >;
      const fn = store[method];
      if (!fn) throw new Error(`unknown method ${method}`);
      return fn.apply(this.store(), msg.args);
    }
    throw new Error(`unknown method ${msg.method}`);
  }
}
