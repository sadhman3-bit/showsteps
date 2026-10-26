import { describe, expect, it } from 'vitest';
import { pipePath } from '../src/main/bridge';
import { currentSid, denyPermissions, freeName, hardenWindow } from '../src/main/harden';

describe('the desktop app’s safety rules (H7)', () => {
  it('names the bridge pipe by the account’s SID', () => {
    expect(pipePath('S-1-5-21-1-2-3-1001')).toBe(
      String.raw`\\.\pipe\showsteps-S-1-5-21-1-2-3-1001`,
    );
    if (process.platform === 'win32') expect(currentSid()).toMatch(/^S-1-5-[0-9-]+$/);
    else expect(currentSid()).toBeUndefined();
  });

  it('stops every window navigating away from the app', () => {
    let listener: ((e: { preventDefault(): void }) => void) | undefined;
    const win = { webContents: { on: (_: 'will-navigate', l: typeof listener) => (listener = l) } };
    expect(hardenWindow(win)).toBe(win);
    let prevented = false;
    listener!({ preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true);
  });

  it('grants pages no permissions', () => {
    let handler: ((wc: unknown, p: string, cb: (granted: boolean) => void) => void) | undefined;
    denyPermissions({ setPermissionRequestHandler: (h) => (handler = h) });
    for (const p of ['media', 'notifications', 'geolocation', 'clipboard-read']) {
      let granted: boolean | undefined;
      handler!(undefined, p, (g) => (granted = g));
      expect(granted).toBe(false);
    }
  });

  it('saves an export under a free name instead of overwriting', () => {
    const taken = new Set(['C:/d/report.pdf', 'C:/d/report (2).pdf', 'C:/d/notes']);
    const exists = (p: string) => taken.has(p.replace(/\\/g, '/'));
    expect(freeName('C:/d', 'invoice.pdf', exists)).toBe('invoice.pdf');
    expect(freeName('C:/d', 'report.pdf', exists)).toBe('report (3).pdf');
    expect(freeName('C:/d', 'notes', exists)).toBe('notes (2)');
  });
});
