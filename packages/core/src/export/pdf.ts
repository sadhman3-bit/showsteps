import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import { strToU8 } from 'fflate';
import { procedureJson, toProcedure } from '../agent/procedure.js';
import { SERIF_FONTS, accentOf, fontOf, textOn } from '../branding.js';
import type { RichText } from '../schema.js';
import { exportDocument, type ExportImage, type ExportInput } from './model.js';

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = PAGE_H - MARGIN;
const BOTTOM = MARGIN + 28; // room for the footer
const INDENT = 36; // step text and pictures sit right of the number
const MAX_IMAGE_H = 430;

const TEXT = hex('#1f1c18');
const MUTED = hex('#5c554b');
const BORDER = hex('#d9d3ca');
const TONES = { tip: '#166534', note: '#1d4ed8', warning: '#92400e', alert: '#b91c1c' };

function hex(value: string): RGB {
  const n = parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** `color` mixed with white: `amount` 0.1 is a 10% tint. */
function tint(value: string, amount: number): RGB {
  const n = parseInt(value.slice(1), 16);
  const mix = (c: number) => (255 - (255 - c) * amount) / 255;
  return rgb(mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255));
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

interface Run {
  text: string;
  font: PDFFont;
  color: RGB;
  underline?: boolean;
}

interface Piece extends Run {
  x: number;
  width: number;
}

interface Line {
  pieces: Piece[];
  width: number;
}

/** Characters the built-in (WinAnsi) fonts lack get a close ASCII stand-in. */
const SUBSTITUTES: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '↑': '^',
  '↓': 'v',
  '✓': 'v',
  '✔': 'v',
  '✕': 'x',
  '✗': 'x',
  '\t': ' ',
};

const encodable = new WeakMap<PDFFont, Map<string, boolean>>();

function safeText(font: PDFFont, text: string): string {
  let cache = encodable.get(font);
  if (!cache) {
    cache = new Map();
    encodable.set(font, cache);
  }
  let out = '';
  for (const ch of text) {
    let ok = cache.get(ch);
    if (ok === undefined) {
      try {
        font.encodeText(ch);
        ok = true;
      } catch {
        ok = false;
      }
      cache.set(ch, ok);
    }
    out += ok ? ch : (SUBSTITUTES[ch] ?? '?');
  }
  return out;
}

function richRuns(rt: RichText, fonts: Fonts, color: RGB, linkColor: RGB): Run[] {
  return rt.spans.map((s) => ({
    text: s.text,
    font:
      s.bold && s.italic
        ? fonts.boldItalic
        : s.bold
          ? fonts.bold
          : s.italic
            ? fonts.italic
            : fonts.regular,
    color: s.href ? linkColor : color,
    ...(s.href ? { underline: true } : {}),
  }));
}

/** Word-wrap styled runs to `maxWidth`. Newlines break lines; over-long words break anywhere. */
function layout(runs: Run[], size: number, maxWidth: number): Line[] {
  const lines: Line[] = [];
  let line: Line = { pieces: [], width: 0 };
  let space = 0;
  const push = () => {
    lines.push(line);
    line = { pieces: [], width: 0 };
    space = 0;
  };
  const place = (run: Run, word: string) => {
    const width = run.font.widthOfTextAtSize(word, size);
    if (line.pieces.length && line.width + space + width > maxWidth) push();
    if (width > maxWidth) {
      // Break a word longer than the line.
      let part = '';
      for (const ch of word) {
        if (part && run.font.widthOfTextAtSize(part + ch, size) > maxWidth) {
          place(run, part);
          push();
          part = '';
        }
        part += ch;
      }
      if (part) place(run, part);
      return;
    }
    const x = line.width + (line.pieces.length ? space : 0);
    line.pieces.push({ ...run, text: word, x, width });
    line.width = x + width;
    space = 0;
  };
  for (const run of runs) {
    const text = safeText(run.font, run.text.replace(/\r/g, ''));
    for (const token of text.split(/(\n| +)/)) {
      if (!token) continue;
      if (token === '\n') push();
      else if (token.startsWith(' ')) {
        if (line.pieces.length) space += run.font.widthOfTextAtSize(' ', size) * token.length;
      } else place(run, token);
    }
  }
  if (line.pieces.length || !lines.length) lines.push(line);
  return lines;
}

class Writer {
  page!: PDFPage;
  y = TOP;
  readonly pages: PDFPage[] = [];

  constructor(readonly pdf: PDFDocument) {}

  newPage(): void {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = TOP;
  }

  /** Start a new page unless `height` fits below the cursor (a fresh page always "fits"). */
  ensure(height: number): void {
    if (this.y - height < BOTTOM && this.y < TOP) this.newPage();
  }

  lines(lines: Line[], x: number, size: number, leading = size * 1.35): void {
    for (const line of lines) {
      this.ensure(leading);
      const baseline = this.y - size;
      for (const p of line.pieces) {
        this.page.drawText(p.text, {
          x: x + p.x,
          y: baseline,
          size,
          font: p.font,
          color: p.color,
        });
        if (p.underline) {
          this.page.drawLine({
            start: { x: x + p.x, y: baseline - 1.5 },
            end: { x: x + p.x + p.width, y: baseline - 1.5 },
            thickness: 0.6,
            color: p.color,
          });
        }
      }
      this.y -= leading;
    }
  }
}

function fit(image: ExportImage, maxW: number, maxH: number): { w: number; h: number } {
  const scale = Math.min(maxW / image.width, maxH / image.height, 1);
  return { w: image.width * scale, h: image.height * scale };
}

async function embed(pdf: PDFDocument, image: ExportImage): Promise<PDFImage> {
  return image.mime === 'image/jpeg' ? pdf.embedJpg(image.bytes) : pdf.embedPng(image.bytes);
}

/**
 * X1: PDF with a cover (title, description, prerequisites), numbered steps with their
 * pictures, headings, callouts, page numbers and the guide's accent colour and font family.
 */
export async function guideToPdf(input: ExportInput): Promise<Uint8Array> {
  const doc = exportDocument(input);
  const L = doc.labels;
  const accentHex = accentOf(input.guide);
  const accent = hex(accentHex);
  const onAccent = hex(textOn(accentHex));
  const pdf = await PDFDocument.create();
  const serif = SERIF_FONTS.has(fontOf(input.guide) ?? '');
  const fonts: Fonts = serif
    ? {
        regular: await pdf.embedFont(StandardFonts.TimesRoman),
        bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
        italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
        boldItalic: await pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
      }
    : {
        regular: await pdf.embedFont(StandardFonts.Helvetica),
        bold: await pdf.embedFont(StandardFonts.HelveticaBold),
        italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
        boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
      };
  const plainRuns = (text: string, font = fonts.regular, color = TEXT): Run[] => [
    { text, font, color },
  ];

  pdf.setTitle(doc.title, { showInWindowTitleBar: true });
  if (doc.description) pdf.setSubject(doc.description);
  pdf.setCreator('ABCXYZ');
  pdf.setProducer('ABCXYZ');
  pdf.setCreationDate(new Date(input.guide.createdAt));
  pdf.setModificationDate(new Date(input.guide.updatedAt));

  const w = new Writer(pdf);

  // ---------- Cover ----------
  w.newPage();
  w.page.drawRectangle({ x: 0, y: PAGE_H - 12, width: PAGE_W, height: 12, color: accent });
  w.y = TOP - 30;
  if (input.logo) {
    const logo = await embed(pdf, input.logo);
    const size = fit(input.logo, 200, 64);
    w.page.drawImage(logo, { x: MARGIN, y: w.y - size.h, width: size.w, height: size.h });
    w.y -= size.h + 36;
  } else {
    w.y -= 60;
  }
  w.lines(layout(plainRuns(doc.title, fonts.bold), 28, CONTENT_W), MARGIN, 28, 34);
  w.y -= 8;
  w.page.drawRectangle({ x: MARGIN, y: w.y, width: 64, height: 4, color: accent });
  w.y -= 20;
  if (doc.description) {
    w.lines(layout(plainRuns(doc.description), 13, CONTENT_W), MARGIN, 13);
    w.y -= 8;
  }
  w.lines(layout(plainRuns(doc.meta, fonts.regular, MUTED), 11, CONTENT_W), MARGIN, 11);
  if (doc.preconditions.length) {
    w.y -= 18;
    w.lines(layout(plainRuns(L.before, fonts.bold), 12, CONTENT_W), MARGIN, 12);
    for (const p of doc.preconditions) {
      w.lines(layout(plainRuns(`•  ${p}`), 11, CONTENT_W - 12), MARGIN + 6, 11);
    }
  }
  if (doc.success) {
    w.y -= 12;
    w.lines(
      layout(
        [
          { text: `${L.success}: `, font: fonts.bold, color: TEXT },
          { text: doc.success, font: fonts.regular, color: TEXT },
        ],
        11,
        CONTENT_W,
      ),
      MARGIN,
      11,
    );
  }

  // ---------- Body ----------
  w.newPage();
  if (!doc.items.length) w.lines(layout(plainRuns(L.noSteps), 12, CONTENT_W), MARGIN, 12);
  for (const item of doc.items) {
    if (item.kind === 'heading') {
      const lines = layout(plainRuns(item.text, fonts.bold, accent), 18, CONTENT_W);
      w.y -= w.y < TOP ? 14 : 0;
      w.ensure(lines.length * 24 + 140); // keep a heading with what follows
      w.lines(lines, MARGIN, 18, 24);
      w.page.drawLine({
        start: { x: MARGIN, y: w.y + 2 },
        end: { x: MARGIN + CONTENT_W, y: w.y + 2 },
        thickness: 1.5,
        color: accent,
      });
      w.y -= 14;
    } else if (item.kind === 'callout') {
      const tone = TONES[item.tone];
      const lines = layout(
        [
          { text: `${item.label}: `, font: fonts.bold, color: hex(tone) },
          { text: item.text, font: fonts.regular, color: TEXT },
        ],
        11,
        CONTENT_W - 28,
      );
      const height = lines.length * 11 * 1.35 + 16;
      w.ensure(height + 10);
      w.page.drawRectangle({
        x: MARGIN,
        y: w.y - height,
        width: CONTENT_W,
        height,
        color: tint(tone, 0.1),
      });
      w.page.drawRectangle({ x: MARGIN, y: w.y - height, width: 4, height, color: hex(tone) });
      w.y -= 8;
      w.lines(lines, MARGIN + 16, 11);
      w.y -= 18;
    } else {
      const textW = CONTENT_W - INDENT;
      const title = layout(richRuns(item.title, fonts, TEXT, accent), 12.5, textW);
      const desc = item.description
        ? layout(richRuns(item.description, fonts, MUTED, accent), 10.5, textW)
        : [];
      const size = item.image ? fit(item.image, textW, MAX_IMAGE_H) : undefined;
      const height =
        title.length * 12.5 * 1.35 + desc.length * 10.5 * 1.35 + (size ? size.h + 12 : 0) + 6;
      w.ensure(Math.min(height, TOP - BOTTOM));
      const top = w.y;
      w.page.drawCircle({ x: MARGIN + 12, y: top - 9, size: 12, color: accent });
      const num = String(item.number);
      const numSize = num.length > 2 ? 8.5 : 10.5;
      w.page.drawText(num, {
        x: MARGIN + 12 - fonts.bold.widthOfTextAtSize(num, numSize) / 2,
        y: top - 9 - numSize * 0.36,
        size: numSize,
        font: fonts.bold,
        color: onAccent,
      });
      w.y -= 2;
      w.lines(title, MARGIN + INDENT, 12.5);
      if (desc.length) {
        w.y -= 2;
        w.lines(desc, MARGIN + INDENT, 10.5);
      }
      if (item.image && size) {
        w.y -= 6;
        w.ensure(size.h);
        const image = await embed(pdf, item.image);
        const x = MARGIN + INDENT;
        w.page.drawImage(image, { x, y: w.y - size.h, width: size.w, height: size.h });
        w.page.drawRectangle({
          x,
          y: w.y - size.h,
          width: size.w,
          height: size.h,
          borderColor: BORDER,
          borderWidth: 0.75,
        });
        w.y -= size.h;
      }
      w.y -= 22;
    }
  }
  if (doc.success) {
    w.ensure(40);
    w.lines(
      layout(
        [
          { text: `${L.success}: `, font: fonts.bold, color: TEXT },
          { text: doc.success, font: fonts.regular, color: TEXT },
        ],
        11,
        CONTENT_W,
      ),
      MARGIN,
      11,
    );
  }

  // U3: one visible line, and the procedure attached to the file as procedure.json.
  w.ensure(30);
  w.y -= 12;
  w.lines(
    layout([{ text: L.agentFooter, font: fonts.regular, color: MUTED }], 9, CONTENT_W),
    MARGIN,
    9,
  );
  await pdf.attach(strToU8(procedureJson(toProcedure(input.guide))), 'procedure.json', {
    mimeType: 'application/json',
    description: L.agentFooter,
    creationDate: new Date(input.guide.createdAt),
    modificationDate: new Date(input.guide.updatedAt),
  });

  // ---------- Footers (every page after the cover) ----------
  const total = w.pages.length;
  w.pages.forEach((page, i) => {
    if (i === 0) return;
    const label = safeText(fonts.regular, L.page(i + 1, total));
    const labelW = fonts.regular.widthOfTextAtSize(label, 9);
    let title = safeText(fonts.regular, doc.title);
    while (title.length > 1 && fonts.regular.widthOfTextAtSize(title, 9) > CONTENT_W - labelW - 24)
      title = `${title.slice(0, -2)}…`;
    page.drawLine({
      start: { x: MARGIN, y: MARGIN + 14 },
      end: { x: MARGIN + CONTENT_W, y: MARGIN + 14 },
      thickness: 0.5,
      color: BORDER,
    });
    page.drawText(title, { x: MARGIN, y: MARGIN, size: 9, font: fonts.regular, color: MUTED });
    page.drawText(label, {
      x: MARGIN + CONTENT_W - labelW,
      y: MARGIN,
      size: 9,
      font: fonts.regular,
      color: MUTED,
    });
  });

  return pdf.save();
}

/** The procedure JSON attached to a PDF made by ABCXYZ, if it has one. */
export async function procedureFromPdf(bytes: Uint8Array): Promise<string | undefined> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const names = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const files = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const list = files?.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!list) return undefined;
  for (let i = 0; i + 1 < list.size(); i += 2) {
    const name = list.lookup(i);
    if (!(name instanceof PDFString || name instanceof PDFHexString)) continue;
    if (name.decodeText() !== 'procedure.json') continue;
    const spec = list.lookup(i + 1, PDFDict);
    const stream = spec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F'));
    if (!(stream instanceof PDFRawStream)) return undefined;
    return new TextDecoder().decode(decodePDFRawStream(stream).decode());
  }
  return undefined;
}
