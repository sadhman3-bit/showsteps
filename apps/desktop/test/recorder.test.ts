import { FolderStore } from '@trailmark/core';
import { nodeFileSystem } from '@trailmark/core/node';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clickEvent,
  desktopTarget,
  isBrowser,
  isRemote,
  keyEvent,
  typeEvent,
} from '../src/main/events';
import type { UiaElement } from '../src/main/helper';
import { LibrarySink } from '../src/main/recorder';

const editor: UiaElement = {
  name: 'Text Editor',
  controlType: 'Document',
  automationId: '15',
  className: 'Edit',
  helpText: '',
  rect: { x: 1969, y: 113, w: 1418, h: 624 },
  isPassword: false,
  isEnabled: true,
  pid: 4242,
  processName: 'notepad',
  windowTitle: 'Untitled - Notepad',
  path: ['Window||Untitled - Notepad', 'Document|15|Text Editor'],
};
const monitor = { x: 1920, y: 0, w: 1920, h: 1080 };
const shot = {
  full: new Uint8Array([1, 2]),
  thumb: new Uint8Array([3]),
  width: 1920,
  height: 1080,
  scale: 1.5,
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('desktop events', () => {
  it('describe UI Automation elements as targets in picture pixels', () => {
    const t = desktopTarget(editor, monitor, { x: 2000, y: 200 });
    expect(t).toMatchObject({
      role: 'textbox',
      name: 'Text Editor',
      bbox: { x: 49, y: 113, w: 1418, h: 624 },
      point: { x: 80, y: 200 },
      uia: { automationId: '15', controlType: 'Document', processName: 'notepad' },
    });
    // A numeric automation id is a weak selector (often a control index).
    expect(t.selectors.map((s) => s.value)).toEqual([
      'Document:Text Editor',
      'id=15',
      'path=Window||Untitled - Notepad > Document|15|Text Editor',
    ]);
    expect(isRemote('mstsc')).toBe(true);
    expect(isBrowser('msedge')).toBe(true);
  });

  it('never read values from password controls', () => {
    const typed = typeEvent({ ...editor, value: 'hello\r\nworld  \r\n' }, monitor, 'now');
    expect(typed).toMatchObject({ kind: 'type', value: 'hello\nworld', sensitive: false });
    const secret = typeEvent({ ...editor, isPassword: true, value: 'hunter2' }, monitor, 'now');
    expect(secret).toMatchObject({ sensitive: true });
    expect('value' in secret).toBe(false);
    expect(keyEvent('Ctrl+S', editor, monitor, 'now')).toMatchObject({
      kind: 'key',
      key: 'Ctrl+S',
    });
  });
});

describe('library sink', () => {
  it('turns desktop events into a guide with screenshots and app list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-sink-'));
    dirs.push(dir);
    const store = new FolderStore(nodeFileSystem, dir, { user: 'Alex' });
    const sink = new LibrarySink(store, 'Notepad');
    await sink.event(
      clickEvent(editor, 'left', monitor, { x: 2000, y: 200 }, '2026-10-10T00:00:00Z'),
      shot,
    );
    await sink.event(
      { ...typeEvent({ ...editor, value: 'Hi' }, monitor, '2026-10-10T00:00:01Z') },
      undefined,
    );
    const menu = {
      ...editor,
      name: 'Format',
      controlType: 'MenuItem',
      automationId: '',
      rect: { x: 2100, y: 60, w: 60, h: 30 },
    };
    await sink.event(
      clickEvent(menu, 'left', monitor, { x: 2110, y: 70 }, '2026-10-10T00:00:02Z'),
      shot,
    );
    expect(sink.stepCount).toBe(2);
    const id = await sink.finish();
    const guide = (await store.getGuide(id!))!;
    const steps = guide.blocks.filter((b) => b.kind === 'step');
    expect(
      steps.map((s) => s.kind === 'step' && s.human.title.spans.map((x) => x.text).join('')),
    ).toEqual(['Type Hi into Text Editor', 'Click Format']);
    expect(guide.apps).toEqual([{ kind: 'desktop', processName: 'notepad' }]);
    const first = steps[0]!;
    expect(first.kind === 'step' && first.human.screenshot).toMatchObject({
      width: 1920,
      height: 1080,
      dpr: 1.5,
    });
    expect((await store.listImages(guide.id)).sort()).toHaveLength(4);
  });
});
