import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { z } from 'zod';

/** Rectangle in physical screen pixels. */
export const PxRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type PxRect = z.infer<typeof PxRectSchema>;

export const UiaElementSchema = z.object({
  name: z.string(),
  controlType: z.string(),
  automationId: z.string(),
  className: z.string(),
  helpText: z.string().optional(),
  rect: PxRectSchema,
  isPassword: z.boolean(),
  isEnabled: z.boolean(),
  pid: z.number(),
  processName: z.string(),
  windowTitle: z.string(),
  path: z.array(z.string()),
  value: z.string().nullable().optional(),
});
export type UiaElement = z.infer<typeof UiaElementSchema>;

const WindowSchema = z.object({
  windowTitle: z.string(),
  pid: z.number(),
  processName: z.string(),
});

export const HelperEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('mouse'),
    button: z.enum(['left', 'right']),
    x: z.number(),
    y: z.number(),
    at: z.string(),
    shot: z.string(),
    monitor: PxRectSchema,
    scale: z.number(),
    window: WindowSchema,
    element: UiaElementSchema.nullable(),
  }),
  z.object({ event: z.literal('key'), key: z.string(), at: z.string() }),
  z.object({ event: z.literal('typing') }),
  z.object({
    event: z.literal('foreground'),
    pid: z.number(),
    processName: z.string(),
    at: z.string(),
  }),
]);
export type HelperEvent = z.infer<typeof HelperEventSchema>;

export interface FindQuery {
  processName?: string;
  windowTitle?: string;
  automationId?: string;
  name?: string;
  controlType?: string;
}

export type InputAction =
  | { type: 'move'; x: number; y: number }
  | { type: 'down' | 'up' | 'click' }
  | { type: 'text'; text: string }
  | { type: 'key'; vk: number }
  | { type: 'wait'; ms: number };

/**
 * Client for uia-helper.exe: UI Automation lookups, screenshots, input, and the capture hooks.
 * Requests are line-delimited JSON with ids; hook events arrive unprompted ("event" lines).
 */
export class UiaHelper extends EventEmitter<{ event: [HelperEvent]; exit: [] }> {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private next = 0;
  private readonly waiting = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(private readonly exe: string) {
    super();
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.proc && this.proc.exitCode === null) return this.proc;
    const proc = spawn(this.exe, [], { windowsHide: true });
    this.proc = proc;
    createInterface({ input: proc.stdout }).on('line', (line) => this.onLine(line));
    proc.on('exit', () => {
      for (const w of this.waiting.values()) {
        clearTimeout(w.timer);
        w.reject(new Error('uia-helper exited'));
      }
      this.waiting.clear();
      this.emit('exit');
    });
    proc.on('error', () => undefined);
    return proc;
  }

  private onLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg && typeof msg === 'object' && 'event' in msg) {
      const ev = HelperEventSchema.safeParse(msg);
      if (ev.success) this.emit('event', ev.data);
      return;
    }
    const reply = msg as { id?: number; ok?: boolean; result?: unknown; error?: string };
    const w = reply.id === undefined ? undefined : this.waiting.get(reply.id);
    if (!w || reply.id === undefined) return;
    this.waiting.delete(reply.id);
    clearTimeout(w.timer);
    if (reply.ok) w.resolve(reply.result);
    else w.reject(new Error(reply.error ?? 'uia-helper error'));
  }

  call<T = unknown>(
    cmd: string,
    args: Record<string, unknown> = {},
    timeoutMs = 10_000,
  ): Promise<T> {
    const proc = this.ensure();
    const id = ++this.next;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`uia-helper ${cmd} timed out`));
      }, timeoutMs);
      this.waiting.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      proc.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`);
    });
  }

  async elementFromPoint(x: number, y: number): Promise<UiaElement | undefined> {
    const r = UiaElementSchema.safeParse(
      await this.call('elementFromPoint', { x, y }).catch(() => null),
    );
    return r.success ? r.data : undefined;
  }

  async focused(): Promise<UiaElement | undefined> {
    const r = UiaElementSchema.safeParse(await this.call('focused').catch(() => null));
    return r.success ? r.data : undefined;
  }

  async find(query: FindQuery): Promise<UiaElement[]> {
    const raw = await this.call<{ matches?: unknown[] }>('find', { query }).catch(() => ({
      matches: [],
    }));
    return (raw.matches ?? []).flatMap((m) => {
      const r = UiaElementSchema.safeParse(m);
      return r.success ? [r.data] : [];
    });
  }

  hook(on: boolean, opts: { dir?: string; ignorePids?: number[] } = {}): Promise<unknown> {
    return this.call('hook', { on, ...opts });
  }

  /** Synthetic input. With `requireForeground`, it is refused unless that app is in front. */
  input(actions: InputAction[], requireForeground?: string): Promise<unknown> {
    return this.call(
      'input',
      { actions, ...(requireForeground ? { requireForeground } : {}) },
      60_000,
    );
  }

  stop(): void {
    this.proc?.stdin.end();
    this.proc = undefined;
  }
}
