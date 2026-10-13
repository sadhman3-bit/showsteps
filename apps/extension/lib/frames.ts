import type { Point } from '@showsteps/core';
import type { IframeGeometry } from './messages';

export interface FrameDeps {
  /** Parent frame id, or -1 for the top frame (webNavigation.getFrame). */
  parentFrameId(tabId: number, frameId: number): Promise<number>;
  /** Ask a frame where its <iframe> holding the child with `token` is. */
  iframeGeometry(tabId: number, frameId: number, token: string): Promise<IframeGeometry>;
}

export interface FramePosition {
  /** Offset of the frame's viewport inside the top frame's viewport, in CSS pixels. */
  offset: Point;
  /** Selector chain from the top document to this frame. */
  frames: string[];
}

/**
 * Remembers each frame's token (a random id the frame posts to its parent) and resolves a
 * frame's position in the top viewport by walking up the parent chain.
 */
export class FrameRegistry {
  private tokens = new Map<string, string>();

  constructor(private readonly deps: FrameDeps) {}

  private key(tabId: number, frameId: number) {
    return `${tabId}:${frameId}`;
  }

  register(tabId: number, frameId: number, token: string): void {
    this.tokens.set(this.key(tabId, frameId), token);
  }

  forgetTab(tabId: number): void {
    for (const k of [...this.tokens.keys()]) if (k.startsWith(`${tabId}:`)) this.tokens.delete(k);
  }

  toJSON(): [string, string][] {
    return [...this.tokens];
  }

  load(entries: [string, string][]): void {
    this.tokens = new Map(entries);
  }

  /** Position of a frame in the top viewport, or null if a link in the chain is unknown. */
  async resolve(tabId: number, frameId: number, depth = 0): Promise<FramePosition | null> {
    if (frameId === 0) return { offset: { x: 0, y: 0 }, frames: [] };
    if (depth > 10) return null;
    const token = this.tokens.get(this.key(tabId, frameId));
    if (!token) return null;
    const parent = await this.deps.parentFrameId(tabId, frameId);
    if (parent < 0) return { offset: { x: 0, y: 0 }, frames: [] };
    const geometry = await this.deps.iframeGeometry(tabId, parent, token);
    if (!geometry) return null;
    const above = await this.resolve(tabId, parent, depth + 1);
    if (!above) return null;
    return {
      offset: { x: above.offset.x + geometry.rect.x, y: above.offset.y + geometry.rect.y },
      frames: [...above.frames, geometry.selector],
    };
  }
}
