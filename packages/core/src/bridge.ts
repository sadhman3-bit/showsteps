import { toBase64 } from './export/model.js';

/**
 * The extension ↔ desktop bridge protocol (Chrome native messaging through showsteps-host.exe
 * to the desktop app's named pipe). Every message is JSON; bytes travel as {"$b64": "..."}.
 * Messages to Chrome are capped at 1 MB, so the desktop app splits large replies into parts.
 */

export const BRIDGE_HOST = 'com.showsteps.host';
/** Unchanged since 1.0: new features are announced as capabilities instead. */
export const BRIDGE_VERSION = 1;
/**
 * What this desktop app can do beyond 1.0, sent in its reply to `hello`. Desktop app 1.0 sends
 * none, so the extension uses a feature only when its capability is listed.
 * - `schedule-wake`: takes `schedule-next { at }` events and starts Chrome when a run is due.
 * - `read-download` (1.2): `readDownload({ path, size })` returns a file Chrome just downloaded,
 *   for Run for me to attach; refused unless it is a fresh regular file of that size, ≤ 25 MB.
 */
export const BRIDGE_CAPABILITIES = ['schedule-wake', 'read-download'] as const;
export type BridgeCapability = (typeof BRIDGE_CAPABILITIES)[number];

/** The desktop app's reply to `hello` (fields after `version` are optional for 1.0). */
export interface HelloReply {
  version: number;
  user?: string;
  library?: string;
  appVersion?: string;
  capabilities?: string[];
  /** The app starts with Windows (so it can open Chrome for runs after a restart). */
  startWithWindows?: boolean;
}
/** Stay well under Chrome's 1 MB limit for one message from a native host. */
export const CHUNK_CHARS = 700_000;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Map([...B64].map((c, i) => [c, i]));

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buf = 0;
  let bits = 0;
  let o = 0;
  for (const ch of clean) {
    const v = LOOKUP.get(ch);
    if (v === undefined) throw new Error('invalid base64');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** JSON with Uint8Array support. */
export function encodeMessage(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v instanceof Uint8Array ? { $b64: toBase64(v) } : v,
  );
}

export function decodeMessage<T = unknown>(text: string): T {
  return JSON.parse(text, (_k, v: unknown) =>
    v && typeof v === 'object' && '$b64' in v && typeof (v as { $b64: unknown }).$b64 === 'string'
      ? fromBase64((v as { $b64: string }).$b64)
      : v,
  ) as T;
}

/** Requests from the extension and the desktop app's replies. */
export interface BridgeRequest {
  id: number;
  method: string;
  args: unknown[];
}
export interface BridgeReply {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}
/** Unprompted messages either way (capture state, guidance steps). */
export interface BridgeEvent {
  event: string;
  data?: unknown;
}
/** Part of a reply that was too big for one message. */
export interface BridgePart {
  part: number;
  of: number;
  id: number;
  text: string;
}

/** Split an encoded message into parts that each fit in one native message. */
export function splitMessage(id: number, text: string, size = CHUNK_CHARS): string[] {
  if (text.length <= size) return [text];
  const parts: string[] = [];
  const of = Math.ceil(text.length / size);
  for (let i = 0; i < of; i++) {
    const part: BridgePart = { part: i, of, id, text: text.slice(i * size, (i + 1) * size) };
    parts.push(JSON.stringify(part));
  }
  return parts;
}

/** Collects parts until a message is whole. */
export class PartCollector {
  private readonly pending = new Map<number, string[]>();

  /** Returns the whole text once every part of message `id` has arrived. */
  add(part: BridgePart): string | undefined {
    const parts = this.pending.get(part.id) ?? new Array<string>(part.of);
    parts[part.part] = part.text;
    this.pending.set(part.id, parts);
    if (parts.filter((p) => p !== undefined).length < part.of) return undefined;
    this.pending.delete(part.id);
    return parts.join('');
  }
}

/** GuideStore methods the extension may call on the desktop library. */
export const BRIDGE_STORE_METHODS = [
  'listGuides',
  'getGuide',
  'saveGuide',
  'trashGuide',
  'restoreGuide',
  'purgeGuide',
  'listVersions',
  'getVersion',
  'putImage',
  'getImage',
  'deleteImage',
  'listImages',
  'readSidecar',
  'writeSidecar',
  'listSidecars',
  'listFolders',
  'saveFolder',
  'deleteFolder',
] as const;
export type BridgeStoreMethod = (typeof BRIDGE_STORE_METHODS)[number];
