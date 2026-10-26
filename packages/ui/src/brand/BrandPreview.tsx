import {
  createGuide,
  createHeading,
  createStep,
  plain,
  type BrandKit,
  type Guide,
  type ResolvedBrand,
} from '@showsteps/core';
import type { ExportInput } from '@showsteps/core/export';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { strings } from '../strings.js';
import { kitAsset, type BrandSources } from './sources.js';

const b = strings.brandKits;

/** A small guide to show a kit on: a heading, three steps, a prerequisite and a description. */
function sampleGuide(): Guide {
  const app = { kind: 'web' as const, url: 'https://example.com/invoices' };
  const box = { selectors: [], bbox: { x: 0, y: 0, w: 1, h: 1 }, point: { x: 0, y: 0 } };
  const step = (title: string, name: string) =>
    createStep({
      action: 'click',
      app,
      target: { ...box, role: 'button', name },
      human: { title: plain(title) },
    });
  return {
    ...createGuide({
      title: b.sample.title,
      blocks: [
        createHeading(b.sample.section),
        step(b.sample.step1, 'New invoice'),
        step(b.sample.step2, 'Save'),
        step(b.sample.step3, 'Send'),
      ],
    }),
    description: b.sample.description,
    preconditions: [b.sample.before],
    author: b.sample.author,
  };
}

/** The kit's pictures and fonts, as an exporter takes them. */
async function exportInput(kit: BrandKit, sources: BrandSources): Promise<ExportInput> {
  const brand: ResolvedBrand = kit.logo
    ? { ...kit, logoFrom: { from: 'kit', kitId: kit.id, name: kit.logo } }
    : kit;
  const picture = async (name: string | undefined) => {
    const bytes = name ? await kitAsset(sources, kit.id, name) : undefined;
    if (!bytes) return undefined;
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return { bytes, ...size, mime: 'image/png' as const };
  };
  const fonts = new Map<string, Uint8Array>();
  for (const f of [kit.fonts.body, kit.fonts.heading]) {
    if (!f?.startsWith('custom:')) continue;
    const bytes = await kitAsset(sources, kit.id, f.slice(7));
    if (bytes) fonts.set(f.slice(7), bytes);
  }
  const [logo, logoOnDark, coverImage] = await Promise.all([
    picture(kit.logo),
    picture(kit.logoOnDark),
    picture(kit.cover.style === 'image' ? kit.cover.image : undefined),
  ]);
  return {
    guide: sampleGuide(),
    images: new Map(),
    brand,
    startLinks: kit.marks.openInLinks,
    ...(logo ? { logo } : {}),
    ...(logoOnDark ? { logoOnDark } : {}),
    ...(coverImage ? { coverImage } : {}),
    ...(fonts.size ? { fonts } : {}),
  };
}

/**
 * B5: the kit on a sample guide, drawn by the real web-page exporter (in a sandboxed frame that
 * runs no scripts), and a PDF made by the real PDF exporter on request.
 */
export function BrandPreview(props: { kit: BrandKit; sources: BrandSources }) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void Promise.all([import('@showsteps/core/export'), exportInput(props.kit, props.sources)])
        .then(([x, input]) => live && setHtml(x.guideToHtml(input)))
        .catch(() => undefined);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [props.kit]);
  const openPdf = async () => {
    const [x, input] = await Promise.all([
      import('@showsteps/core/export'),
      exportInput(props.kit, props.sources),
    ]);
    const bytes = await x.guideToPdf(input);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <section class="ss-brandkits__preview" aria-labelledby="ss-brand-preview-h">
      <div class="ss-row">
        <h3 id="ss-brand-preview-h">{b.preview}</h3>
        <Button size="sm" onClick={() => void openPdf()}>
          {b.previewPdf}
        </Button>
      </div>
      <iframe class="ss-brandkits__frame" title={b.previewFrame} sandbox="" srcdoc={html} />
    </section>
  );
}
