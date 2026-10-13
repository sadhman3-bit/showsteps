import type { CaptureEvent } from '@showsteps/core';
import type { BridgeServer } from './bridge';
import type { CaptureSink, DesktopShot } from './recorder';

/**
 * Shared session: the extension's capture owns the guide, and desktop steps are sent to it,
 * so one guide holds both browser and desktop steps with a single writer.
 */
export class ExtensionSink implements CaptureSink {
  stepCount = 0;

  constructor(private readonly bridge: BridgeServer) {}

  async event(ev: CaptureEvent, shot: DesktopShot | undefined): Promise<void> {
    this.bridge.sendEvent('desktop-event', { event: ev, ...(shot ? { shot } : {}) });
    await Promise.resolve();
  }

  async deleteLast(): Promise<void> {
    this.bridge.sendEvent('capture-request', { action: 'delete-last' });
    await Promise.resolve();
  }

  async finish(): Promise<string | undefined> {
    this.bridge.sendEvent('capture-request', { action: 'finish' });
    return Promise.resolve(undefined);
  }

  async cancel(): Promise<void> {
    this.bridge.sendEvent('capture-request', { action: 'cancel' });
    await Promise.resolve();
  }
}
