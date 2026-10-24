import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeClient, readDownloadVia } from '../lib/bridge';

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
      // Desktop app 1.2: the file's bytes, as the bridge sends them.
      if (msg.method === 'readDownload')
        queueMicrotask(() =>
          onMessage.forEach((l) => l({ id: msg.id, ok: true, result: { $b64: 'JVBERi0=' } })),
        );
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

  const download = {
    filename: 'C:\\Users\\me\\Downloads\\statement.pdf',
    fileSize: 5,
    mime: 'application/pdf',
  };

  it('desktop app 1.1 is never asked to read a download', async () => {
    const d = fakeDesktop({ version: 1, appVersion: '1.1.0', capabilities: ['schedule-wake'] });
    const client = new BridgeClient('background');
    await client.connect();
    expect(client.can('read-download')).toBe(false);
    expect(await readDownloadVia(client, download)).toBeUndefined();
    expect(d.sent.some((m) => m.method === 'readDownload')).toBe(false);
  });

  it('desktop app 1.2 reads the downloaded file', async () => {
    const d = fakeDesktop({
      version: 1,
      appVersion: '1.2.0',
      capabilities: ['schedule-wake', 'read-download'],
    });
    const client = new BridgeClient('background');
    await client.connect();
    const blob = await readDownloadVia(client, download);
    expect(await blob?.text()).toBe('%PDF-');
    expect(blob?.type).toBe('application/pdf');
    expect(d.sent.find((m) => m.method === 'readDownload')).toMatchObject({
      args: [{ path: download.filename, size: 5 }],
    });
  });
});
