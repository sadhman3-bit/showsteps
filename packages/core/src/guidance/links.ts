// Guide Me and Run for me links in exported files: the guide's start page with a marker in the
// URL fragment (`#showsteps=1&guide=<id>&mode=guide|run&v=<version>`). Browsers never send the
// fragment to the website; the extension spots it and offers to start.
import type { Guide } from '../schema.js';
import { guideVersion } from '../schedule/version.js';
import { guideSteps } from './plan.js';

export type StartMode = 'guide' | 'run';

export interface StartLink {
  guideId: string;
  mode: StartMode;
  /** `guideVersion` of the copy the file was made from. */
  version: string;
}

/** Longest guide ID a link carries. */
export const MAX_LINK_ID = 200;

const KEYS = ['showsteps', 'guide', 'mode', 'v'];
const VERSION = /^[0-9a-z]{1,16}$/;

/** The page Guide Me and Run for me start on: the first web step's address (http or https). */
export function guideStartUrl(guide: Guide): string | undefined {
  const step = guideSteps(guide).find((s) => s.app.kind === 'web');
  if (!step || step.app.kind !== 'web') return undefined;
  try {
    const u = new URL(step.app.url);
    return /^https?:$/.test(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** The start page with the marker in place of its fragment, or undefined (no web step). */
export function buildStartLink(guide: Guide, mode: StartMode): string | undefined {
  const start = guideStartUrl(guide);
  if (!start || !guide.id || guide.id.length > MAX_LINK_ID) return undefined;
  const u = new URL(start);
  u.hash = `showsteps=1&guide=${encodeURIComponent(guide.id)}&mode=${mode}&v=${guideVersion(guide)}`;
  return u.href;
}

/** The marker in a URL, or undefined unless it is exactly the four known keys, well formed. */
export function parseStartLink(url: string): StartLink | undefined {
  let hash: string;
  try {
    hash = new URL(url).hash.slice(1);
  } catch {
    return undefined;
  }
  if (!hash.startsWith('showsteps=')) return undefined;
  const parts = hash.split('&');
  if (parts.length !== KEYS.length) return undefined;
  const fields = new Map<string, string>();
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 1) return undefined;
    const key = part.slice(0, eq);
    if (!KEYS.includes(key) || fields.has(key)) return undefined;
    let value: string;
    try {
      value = decodeURIComponent(part.slice(eq + 1));
    } catch {
      return undefined;
    }
    fields.set(key, value);
  }
  const guideId = fields.get('guide') ?? '';
  const mode = fields.get('mode');
  const version = fields.get('v') ?? '';
  if (fields.get('showsteps') !== '1') return undefined;
  if (!guideId || guideId.length > MAX_LINK_ID) return undefined;
  if ([...guideId].some((c) => c.charCodeAt(0) < 32)) return undefined;
  if (mode !== 'guide' && mode !== 'run') return undefined;
  if (!VERSION.test(version)) return undefined;
  return { guideId, mode, version };
}

/** The URL without the marker (the fragment emptied), for removing it from the address bar. */
export function withoutStartLink(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}
