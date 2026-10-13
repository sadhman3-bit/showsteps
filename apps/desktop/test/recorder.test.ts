import { FolderStore, type CaptureEvent } from '@showsteps/core';
import { nodeFileSystem } from '@showsteps/core/node';
import { EventEmitter } from 'node:events';
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
import type { HelperEvent, UiaElement, UiaHelper } from '../src/main/helper';
import { DesktopRecorder, LibrarySink, type CaptureSink } from '../src/main/recorder';

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
    const dir = mkdtempSync(join(tmpdir(), 'ss-sink-'));
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

describe('desktop recorder', () => {
  /** A stand-in for uia-helper: emits hook events and answers "what has focus". */
  function fakeHelper(focused: () => UiaElement | undefined) {
    const emitter = new EventEmitter<{ event: [HelperEvent]; exit: [] }>();
    return Object.assign(emitter, {
      hook: async () => true,
      focused: async () => focused(),
    }) as unknown as UiaHelper & EventEmitter<{ event: [HelperEvent]; exit: [] }>;
  }

  it('commits typing as soon as another app comes to the front', async () => {
    let focus: UiaElement | undefined = { ...editor, value: 'Invoice 1043' };
    const helper = fakeHelper(() => focus);
    const events: CaptureEvent[] = [];
    const sink: CaptureSink = {
      stepCount: 0,
      event: async (ev) => void events.push(ev),
      deleteLast: async () => undefined,
      finish: async () => 'g1',
      cancel: async () => undefined,
    };
    const recorder = new DesktopRecorder({
      helper,
      readShot: () => Promise.reject(new Error('no shots')),
      ownPids: () => [],
      shotDir: tmpdir(),
      onState: () => undefined,
    });
    await recorder.start(sink, true);
    helper.emit('event', { event: 'typing' });
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toHaveLength(0);
    // Same app in front again: nothing yet. The browser in front: the typing is a step now.
    helper.emit('event', { event: 'foreground', pid: editor.pid, processName: 'notepad', at: '' });
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toHaveLength(0);
    focus = undefined;
    helper.emit('event', { event: 'foreground', pid: 77, processName: 'chrome', at: '' });
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toMatchObject([{ kind: 'type', value: 'Invoice 1043' }]);
    await recorder.finish();
    expect(events).toHaveLength(1);
  });

  it('commits typing when focus moves to another app without a foreground event', async () => {
    let focus: UiaElement | undefined = { ...editor, value: 'Hello' };
    const helper = fakeHelper(() => focus);
    const events: CaptureEvent[] = [];
    const recorder = new DesktopRecorder({
      helper,
      readShot: () => Promise.reject(new Error('no shots')),
      ownPids: () => [],
      shotDir: tmpdir(),
      onState: () => undefined,
    });
    await recorder.start(
      {
        stepCount: 0,
        event: async (ev) => void events.push(ev),
        deleteLast: async () => undefined,
        finish: async () => 'g1',
        cancel: async () => undefined,
      },
      true,
    );
    helper.emit('event', { event: 'typing' });
    await new Promise((r) => setTimeout(r, 300));
    expect(events).toHaveLength(0);
    focus = { ...editor, pid: 77, processName: 'chrome', name: 'Address bar' };
    await expect.poll(() => events.length, { timeout: 2000 }).toBe(1);
    expect(events[0]).toMatchObject({ kind: 'type', value: 'Hello' });
    await recorder.finish();
  });
});
