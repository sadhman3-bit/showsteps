import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  TextRun,
} from 'docx';
import { accentOf, fontOf } from '../branding.js';
import type { RichText } from '../schema.js';
import { exportDocument, type ExportImage, type ExportInput } from './model.js';

const TONES = { tip: '166534', note: '1D4ED8', warning: '92400E', alert: 'B91C1C' };
const TONE_FILL = { tip: 'ECF7EF', note: 'EAF0FD', warning: 'FDF3E6', alert: 'FDECEC' };
const MUTED = '5C554B';
const INDENT = 540; // twips: step text and pictures sit right of the number
const MAX_W = 600; // pixels (Word lays images out at 96 per inch)
const MAX_H = 560;

type Child = TextRun | ExternalHyperlink;

/** Text with line breaks as Word runs. */
function textRuns(text: string, opts: { bold?: boolean; italics?: boolean; color?: string } = {}) {
  return text.split('\n').map((line, i) => new TextRun({ text: line, ...opts, break: i ? 1 : 0 }));
}

function richRuns(rt: RichText): Child[] {
  return rt.spans.flatMap((s): Child[] => {
    const runs = textRuns(s.text, {
      ...(s.bold ? { bold: true } : {}),
      ...(s.italic ? { italics: true } : {}),
    });
    if (!s.href) return runs;
    return [
      new ExternalHyperlink({
        link: s.href,
        children: [
          new TextRun({
            text: s.text,
            style: 'Hyperlink',
            ...(s.bold ? { bold: true } : {}),
            ...(s.italic ? { italics: true } : {}),
          }),
        ],
      }),
    ];
  });
}

function size(image: ExportImage, maxW: number, maxH: number) {
  const scale = Math.min(maxW / image.width, maxH / image.height, 1);
  return { width: Math.round(image.width * scale), height: Math.round(image.height * scale) };
}

function imageRun(image: ExportImage, maxW: number, maxH: number, name: string, alt: string) {
  return new ImageRun({
    type: image.mime === 'image/jpeg' ? 'jpg' : 'png',
    data: image.bytes,
    transformation: size(image, maxW, maxH),
    altText: { name, description: alt, title: alt },
  });
}

/**
 * X2: Word document with real Title and Heading styles, numbered steps (a Word list),
 * pictures with alt text and callouts as shaded paragraphs.
 */
export async function guideToDocx(input: ExportInput): Promise<Uint8Array> {
  const doc = exportDocument(input);
  const L = doc.labels;
  const accent = accentOf(input.guide).slice(1).toUpperCase();
  const font = fontOf(input.guide) ?? 'Segoe UI';
  const children: Paragraph[] = [];

  if (input.logo) {
    children.push(
      new Paragraph({
        children: [imageRun(input.logo, 240, 56, 'Logo', '')],
        spacing: { after: 240 },
      }),
    );
  }
  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: textRuns(doc.title) }));
  if (doc.description) children.push(new Paragraph({ children: textRuns(doc.description) }));
  children.push(new Paragraph({ children: textRuns(doc.meta, { color: MUTED }) }));
  if (doc.preconditions.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: L.before, bold: true })],
        spacing: { before: 200 },
      }),
    );
    for (const p of doc.preconditions) {
      children.push(new Paragraph({ bullet: { level: 0 }, children: textRuns(p) }));
    }
  }
  if (!doc.items.length) children.push(new Paragraph({ children: textRuns(L.noSteps) }));

  for (const item of doc.items) {
    if (item.kind === 'heading') {
      children.push(
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: textRuns(item.text) }),
      );
    } else if (item.kind === 'callout') {
      children.push(
        new Paragraph({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: TONE_FILL[item.tone] },
          border: {
            left: { style: BorderStyle.SINGLE, size: 24, color: TONES[item.tone], space: 8 },
          },
          indent: { left: 160, right: 160 },
          spacing: { before: 160, after: 160 },
          children: [
            new TextRun({ text: `${item.label}: `, bold: true, color: TONES[item.tone] }),
            ...textRuns(item.text),
          ],
        }),
      );
    } else {
      children.push(
        new Paragraph({
          numbering: { reference: 'steps', level: 0 },
          keepNext: true,
          spacing: { before: 240, after: 60 },
          children: richRuns(item.title),
        }),
      );
      if (item.description) {
        children.push(
          new Paragraph({
            indent: { left: INDENT },
            keepNext: !!item.image,
            spacing: { after: 60 },
            children: richRuns(item.description),
          }),
        );
      }
      if (item.image) {
        children.push(
          new Paragraph({
            indent: { left: INDENT },
            spacing: { after: 120 },
            children: [
              imageRun(item.image, MAX_W, MAX_H, item.imageName ?? L.step(item.number), item.alt),
            ],
          }),
        );
      }
    }
  }
  if (doc.success) {
    children.push(
      new Paragraph({
        spacing: { before: 240 },
        children: [new TextRun({ text: `${L.success}: `, bold: true }), ...textRuns(doc.success)],
      }),
    );
  }

  // "Page {n} of {total}" with live page fields in place of the numbers.
  const pageParts = L.page(-1, -2)
    .split(/(-1|-2)/)
    .filter(Boolean)
    .map((part) =>
      part === '-1' ? PageNumber.CURRENT : part === '-2' ? PageNumber.TOTAL_PAGES : part,
    );

  const file = new Document({
    creator: 'Trailmark',
    title: doc.title,
    ...(doc.description ? { description: doc.description } : {}),
    styles: {
      default: {
        document: { run: { font, size: 21 }, paragraph: { spacing: { after: 80 } } },
        title: { run: { font, size: 52, bold: true, color: '1F1C18' } },
        heading1: {
          run: { font, size: 30, bold: true, color: accent },
          paragraph: { spacing: { before: 360, after: 120 }, keepNext: true },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'steps',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: {
                paragraph: { indent: { left: INDENT, hanging: INDENT } },
                run: { bold: true, color: accent },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ children: pageParts, color: MUTED, size: 18 })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(file));
}
