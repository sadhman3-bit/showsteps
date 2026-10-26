import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pipePath } from '../src/main/bridge';
import { currentSid } from '../src/main/harden';

const HOST = join(__dirname, '..', 'resources', 'bin', 'showsteps-host.exe');

/** The first message the host writes to "Chrome" (4-byte length, then JSON). */
function firstMessage(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const host = spawn(HOST, [], { windowsHide: true });
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      host.kill();
      reject(new Error('no reply from the host'));
    }, 10_000);
    host.stdout.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length < 4) return;
      const n = buf.readInt32LE(0);
      if (buf.length < 4 + n) return;
      clearTimeout(timer);
      host.kill();
      resolve(JSON.parse(buf.subarray(4, 4 + n).toString('utf8')));
    });
    host.on('error', reject);
  });
}

describe.runIf(process.platform === 'win32' && existsSync(HOST))('showsteps-host.exe (H7)', () => {
  it('relays only to ShowSteps: a pipe served by another program gets "untrusted"', async () => {
    const sid = currentSid()!;
    // Node, not ShowSteps.exe, holds the pipe the host connects to.
    const server = createServer((socket) => socket.on('error', () => undefined));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePath(sid), resolve);
    });
    try {
      expect(await firstMessage()).toEqual({ type: 'offline', reason: 'untrusted' });
    } finally {
      server.close();
    }
  });

  it('says offline when nothing serves the pipe', async () => {
    expect(await firstMessage()).toEqual({ type: 'offline' });
  });
});
