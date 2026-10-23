import {
  ARCHIVE_EXTENSION,
  exportGuideArchive,
  type Guide,
  type GuideStore,
} from '@showsteps/core';
import type { ExportInput } from '@showsteps/core/export';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Dialog } from '../components/Dialog.js';
import { downloadBytes, safeFileName, usePreference } from '../hooks.js';
import { strings } from '../strings.js';
import { prepareExport } from './flatten.js';
import { canPickFolder, pickFolder, rememberedFolder, saveFiles } from './folder.js';

const s = strings.share;
type Format = keyof typeof s.formats;

const MIME: Record<Format, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  markdown: 'application/zip',
  html: 'text/html',
  embed: 'text/html',
  showsteps: 'application/zip',
  agentpack: 'application/zip',
};

const encode = (text: string) => new TextEncoder().encode(text);

// The PDF and Word libraries load only when someone exports.
const exporters = () => import('@showsteps/core/export');

export function fileNameFor(title: string, format: Format): string {
  const base = safeFileName(title);
  switch (format) {
    case 'pdf':
      return `${base}.pdf`;
    case 'docx':
      return `${base}.docx`;
    case 'markdown':
      return `${base} (Markdown).zip`;
    case 'html':
      return `${base}.html`;
    case 'embed':
      return `${base}.embed.html`;
    case 'showsteps':
      return `${base}${ARCHIVE_EXTENSION}`;
    case 'agentpack':
      return `${base} (Agent Pack).zip`;
  }
}

export interface ShareDialogProps {
  store: GuideStore;
  guide: Guide;
  onClose: () => void;
  /** Open the print view (the host owns routing). */
  onPrint?: () => void;
}

/** X8: every way to share a guide without a server: files, rich clipboard, print and a folder. */
export function ShareDialog({ store, guide, onClose, onPrint }: ShareDialogProps) {
  const prepared = useRef<Promise<ExportInput> | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [folder, setFolder] = useState<Awaited<ReturnType<typeof rememberedFolder>>>();
  // 1.2: Guide Me and Run for me links under the title (web guides only); on unless turned off.
  const [links, setLinks] = usePreference<'on' | 'off'>('share.startLinks', 'on');
  const hasWebStep = guide.blocks.some((b) => b.kind === 'step' && b.app.kind === 'web');

  useEffect(() => {
    void rememberedFolder().then(setFolder);
  }, []);

  /** Pictures are flattened once per dialog and shared by every export. */
  const input = async (): Promise<ExportInput> => ({
    ...(await (prepared.current ??= prepareExport(store, guide))),
    startLinks: hasWebStep && links === 'on',
  });

  async function bytesFor(format: Format): Promise<Uint8Array> {
    if (format === 'showsteps') return exportGuideArchive(store, guide.id);
    const [x, data] = await Promise.all([exporters(), input()]);
    switch (format) {
      case 'pdf':
        return x.guideToPdf(data);
      case 'docx':
        return x.guideToDocx(data);
      case 'markdown':
        return x.guideToMarkdownZip(data);
      case 'html':
        return encode(x.guideToHtml(data));
      case 'embed':
        return encode(x.guideToEmbedHtml(data));
      case 'agentpack':
        return x.guideToAgentPack(data);
    }
  }

  async function run(task: () => Promise<string>) {
    setBusy(true);
    setStatus(s.preparing);
    try {
      setStatus(await task());
    } catch {
      setStatus(s.failed);
    } finally {
      setBusy(false);
    }
  }

  const download = (format: Format) =>
    run(async () => {
      const name = fileNameFor(guide.title, format);
      downloadBytes(await bytesFor(format), name, MIME[format]);
      return s.downloaded(name);
    });

  const copyHtml = () => {
    // The clipboard write must start inside the click; its contents can arrive later.
    const data = Promise.all([exporters(), input()]);
    const blob = (type: string, make: (x: Awaited<typeof data>) => string) =>
      data.then((d) => new Blob([make(d)], { type }));
    setBusy(true);
    setStatus(s.preparing);
    navigator.clipboard
      .write([
        new ClipboardItem({
          'text/html': blob('text/html', ([x, d]) => x.guideToClipboardHtml(d)),
          'text/plain': blob('text/plain', ([x, d]) => x.guideToText(d)),
        }),
      ])
      .then(
        () => setStatus(s.copied),
        () => setStatus(s.copyFailed),
      )
      .finally(() => setBusy(false));
  };

  const chooseFolder = async () => {
    try {
      const handle = await pickFolder();
      if (handle) setFolder(handle);
    } catch {
      setStatus(s.folderDenied);
    }
  };

  const saveToFolder = (handle: NonNullable<typeof folder>) =>
    run(async () => {
      const formats: Format[] = ['html', 'embed', 'showsteps'];
      const files = [];
      for (const f of formats)
        files.push({ name: fileNameFor(guide.title, f), bytes: await bytesFor(f) });
      if (!(await saveFiles(handle, files))) return s.folderDenied;
      return s.savedToFolder(files.length, handle.name);
    });

  return (
    <Dialog title={s.title} onClose={onClose}>
      <div class="ss-share" aria-busy={busy}>
        <p class="ss-muted">{s.privacy}</p>
        {hasWebStep ? (
          <label class="ss-check">
            <input
              type="checkbox"
              checked={links === 'on'}
              onChange={(e) => setLinks(e.currentTarget.checked ? 'on' : 'off')}
            />{' '}
            {s.startLinks}
          </label>
        ) : null}
        <h3>{s.download}</h3>
        <ul class="ss-share__grid">
          {(Object.keys(s.formats) as Format[]).map((f) => (
            <li key={f}>
              <button
                type="button"
                class="ss-share__format"
                disabled={busy}
                onClick={() => void download(f)}
              >
                <strong>{s.formats[f][0]}</strong>
                <span>{s.formats[f][1]}</span>
              </button>
            </li>
          ))}
        </ul>
        <h3>{s.copyHeading}</h3>
        <div class="ss-share__row">
          <Button variant="primary" disabled={busy} onClick={copyHtml}>
            {s.copyHtml}
          </Button>
          {onPrint ? (
            <Button disabled={busy} onClick={onPrint}>
              {s.print}
            </Button>
          ) : null}
        </div>
        <p class="ss-muted ss-share__hint">{s.copyHtmlHint}</p>
        <h3>{s.folder}</h3>
        <p class="ss-muted ss-share__hint">{s.folderHint}</p>
        {canPickFolder() ? (
          <div class="ss-share__row">
            <span class="ss-share__folder">
              {folder ? s.folderCurrent(folder.name) : s.folderNone}
            </span>
            <Button disabled={busy} onClick={() => void chooseFolder()}>
              {folder ? s.changeFolder : s.chooseFolder}
            </Button>
            {folder ? (
              <Button variant="primary" disabled={busy} onClick={() => void saveToFolder(folder)}>
                {s.saveToFolder}
              </Button>
            ) : null}
          </div>
        ) : (
          <p>{s.folderUnsupported}</p>
        )}
        <p class="ss-share__status" role="status">
          {status}
        </p>
      </div>
    </Dialog>
  );
}
