/** Random, URL- and filename-safe identifier (UUID v4 from Web Crypto, available in browsers and Node). */
export function createId(): string {
  return globalThis.crypto.randomUUID();
}

/** Current time as an ISO 8601 string. */
export function nowIso(): string {
  return new Date().toISOString();
}
