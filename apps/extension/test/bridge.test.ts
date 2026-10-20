import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeClient } from '../lib/bridge';

type Listener = (msg: unknown) => void;

/** A native messaging port to a stand-in desktop app that answers hello with `reply`. */
function fakeDesktop(reply: object) {
  const sent: { event?: string; method?: string; data?: unknown }[] = [];
  const onMessage: Listener[] = [];
  const port = {
    onMessage: { addListener: (l: Listener) => onMessage.push(l) },
    onDisconnect: { addListener: () => undefined },
    disconnect: () => undefined,
    postMessage(msg: { id?: number; method?: string; event?: string; data?: unknown }) {
      sent.push(msg);
      if (msg.method === 'hello')
        queueMicrotask(() => onMessage.forEach((l) => l({ id: msg.id, ok: true, result: reply })));
    },
  };
  const spy = vi
    .spyOn(browser.runtime, 'connectNative')
    .mockReturnValue(port as unknown as Browser.runtime.Port);
  return {
    sent,
    events: () => sent.filter((m) => m.event).map((m) => m.event),
    push: (msg: unknown) => onMessage.forEach((l) => l(msg)),
    spy,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('desktop app versions', () => {
  it('desktop app 1.0 (no capabilities) never gets schedule features', async () => {
    fakeDesktop({ version: 1, user: 'Alex', library: 'C:\\Lib' });
    const client = new BridgeClient('background');
    expect(await client.connect()).toBe(true);
    expect(client.can('schedule-wake')).toBe(false);
    expect(client.startWithWindows).toBeUndefined();
  });

  it('desktop app 1.1 offers schedule-wake and reports Start with Windows as it changes', async () => {
    const d = fakeDesktop({
      version: 1,
      appVersion: '1.1.0',
      capabilities: ['schedule-wake'],
      startWithWindows: false,
    });
    const client = new BridgeClient('background');
    expect(await client.connect()).toBe(true);
    expect(client.can('schedule-wake')).toBe(true);
    expect(client.startWithWindows).toBe(false);
    d.push({ event: 'desktop-info', data: { startWithWindows: true } });
    expect(client.startWithWindows).toBe(true);
    client.sendEvent('schedule-next', { at: '2026-10-21T09:00:00.000Z' });
    expect(d.events()).toContain('schedule-next');
    // Disconnected: nothing is claimed any more.
    client.disconnect();
    expect(client.can('schedule-wake')).toBe(false);
  });
});
