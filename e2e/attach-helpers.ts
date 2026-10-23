import { createGuide, createStep, plain, type Guide, type Step } from '@showsteps/core';
import type { Worker } from '@playwright/test';

// 1.2: guides that download a file on the demo app's Exports page and attach it on its Send page.

export const EXPORTS = 'http://localhost:5173/exports.html';
export const SEND = 'http://localhost:5173/send.html';

const box = { bbox: { x: 0, y: 0, w: 120, h: 24 }, point: { x: 60, y: 12 } };

export type Download = 'link' | 'blob' | 'post';

const DOWNLOADS: Record<Download, { title: string; role: string; name: string; css: string }> = {
  link: { title: 'Click Download PDF', role: 'link', name: 'Download PDF', css: 'a[download]' },
  blob: {
    title: 'Click Export CSV',
    role: 'link',
    name: 'Export CSV',
    css: 'a[download="invoices.csv"]',
  },
  post: {
    title: 'Click Export statement',
    role: 'button',
    name: 'Export statement',
    css: 'form button',
  },
};

/**
 * Open Exports, click a download, open Send (optionally with `?query`), click Attach, upload
 * (the file from the download step when `from` is set), and click Send.
 */
export function attachGuide(
  opts: {
    download?: Download;
    from?: 'step' | 'latest';
    query?: string;
    title?: string;
    file?: string;
  } = {},
): { guide: Guide; steps: Step[] } {
  const d = DOWNLOADS[opts.download ?? 'link'];
  const exportsApp = { kind: 'web' as const, url: EXPORTS, title: 'Exports · Ledgerline' };
  const sendUrl = SEND + (opts.query ? `?${opts.query}` : '');
  const sendApp = { kind: 'web' as const, url: sendUrl, title: 'Send · Ledgerline' };
  const download = createStep({
    action: 'click',
    app: exportsApp,
    target: {
      ...box,
      role: d.role,
      name: d.name,
      text: d.name,
      tag: d.role === 'link' ? 'a' : 'button',
      selectors: [{ type: 'css', value: d.css, score: 0.7 }],
    },
    human: { title: plain(d.title) },
  });
  const file = opts.file ?? (opts.download === 'blob' ? 'invoices.csv' : 'report.pdf');
  const steps = [
    createStep({ action: 'navigate', app: exportsApp, human: { title: plain('Open Exports') } }),
    download,
    createStep({ action: 'navigate', app: sendApp, human: { title: plain('Open Send') } }),
    createStep({
      action: 'click',
      app: sendApp,
      target: {
        ...box,
        role: 'button',
        name: 'Attach',
        text: 'Attach',
        tag: 'button',
        selectors: [{ type: 'css', value: 'button', score: 0.3 }],
      },
      human: { title: plain('Click Attach') },
    }),
    createStep({
      action: 'upload',
      app: sendApp,
      target: {
        ...box,
        label: 'Attachment',
        name: 'Attachment',
        tag: 'input',
        selectors: [{ type: 'css', value: 'input[type="file"]', score: 0.8 }],
      },
      input: {
        mode: 'fixed',
        value: file,
        sensitive: false,
        ...(opts.from
          ? { from: { download: opts.from === 'latest' ? 'latest' : download.id } }
          : {}),
      },
      human: { title: plain(`Upload ${file}`) },
      agent: { timeoutMs: 15_000, confirm: false, visualOnly: false },
    }),
    createStep({
      action: 'click',
      app: sendApp,
      target: {
        ...box,
        role: 'button',
        name: 'Send',
        text: 'Send',
        tag: 'button',
        selectors: [{ type: 'css', value: 'button.primary', score: 0.5 }],
      },
      human: { title: plain('Click Send') },
      agent: {
        timeoutMs: 10_000,
        confirm: false,
        visualOnly: false,
        expect: [{ type: 'text', contains: 'Sent with 1 attachment.' }],
      },
    }),
  ];
  const guide = createGuide({
    title: opts.title ?? 'Send the monthly report',
    apps: [{ kind: 'web', origin: 'http://localhost:5173' }],
    blocks: steps,
  });
  return { guide, steps };
}

declare const __showsteps: { store: { saveGuide(g: Guide): Promise<void> } };

/** Save a guide in the extension's library. */
export async function saveGuide(sw: Worker, guide: Guide): Promise<void> {
  await sw.evaluate((g) => __showsteps.store.saveGuide(g), guide);
}
