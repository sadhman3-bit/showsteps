import {
  LineCapStyle,
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
import { CHROME, LIGHT } from '../tokens.js';
import { trailGeometry } from '../patterns.js';
import { PDF_DISPLAY_800, PDF_SANS_400, PDF_SANS_700 } from './fonts.generated.js';
import fontkit from '@pdf-lib/fontkit';

const SIGNAL = HIGHLIGHT_COLOR;
import { BRAND_FONTS, HIGHLIGHT_COLOR, SERIF_FONTS, textOn } from '../branding.js';
import { coverOrder, expandTokens, resolveBrand, type ResolvedBrand } from '../brandkit.js';
import type { RichText } from '../schema.js';
import { exportDocument, type ExportImage, type ExportInput } from './model.js';

const MARGIN = 50;
const INDENT = 36; // step text and pictures sit right of the number
const MAX_IMAGE_H = 430;

const TEXT = hex(LIGHT.text);
const MUTED = hex(LIGHT.textMuted);
const BORDER = hex(LIGHT.line);
const TONES = { tip: LIGHT.tip, note: LIGHT.note, warning: LIGHT.warning, alert: LIGHT.alert };
const TONE_BG = {
  tip: LIGHT.tipBg,
  note: LIGHT.noteBg,
  warning: LIGHT.warningBg,
  alert: LIGHT.alertBg,
};

/** Page size and the area text may use: room for a header line, the footer and a notice. */
interface Geometry {
  PAGE_W: number;
  PAGE_H: number;
  CONTENT_W: number;
  TOP: number;
  BOTTOM: number;
}

function pageGeometry(brand: ResolvedBrand, headerLine: boolean): Geometry {
  const [PAGE_W, PAGE_H] = brand.page.size === 'Letter' ? [612, 792] : [595.28, 841.89];
  return {
    PAGE_W,
    PAGE_H,
    CONTENT_W: PAGE_W - MARGIN * 2,
    TOP: PAGE_H - MARGIN - (headerLine ? 22 : 0),
    BOTTOM: MARGIN + 28 + (brand.page.notice ? 14 : 0),
  };
}

/** Cover band heights for the kit's small, medium and large covers. */
const BAND = { small: 160, medium: 230, large: 320 } as const;

/** The Trail pattern (pink path, numbered stops) in a box whose bottom-left is (x, y). */
function drawTrail(page: PDFPage, font: PDFFont, x: number, y: number, w: number, h: number) {
  const { d, stops } = trailGeometry(w, h);
  // SVG coordinates run down from the top; PDF paths drawn with drawSvgPath do the same.
  page.drawSvgPath(d, {
    x,
    y: y + h,
    borderColor: hex(SIGNAL),
    borderWidth: 8,
    borderLineCap: LineCapStyle.Round,
  });
  stops.forEach((p, i) => {
    const last = i === stops.length - 1;
    page.drawCircle({
      x: x + p.x,
      y: y + h - p.y,
      size: 13,
      color: hex(last ? SIGNAL : LIGHT.surface),
      borderColor: hex(CHROME.bg),
      borderWidth: 2.5,
    });
    const n = String(i + 1);
    page.drawText(n, {
      x: x + p.x - font.widthOfTextAtSize(n, 12) / 2,
      y: y + h - p.y - 4.3,
      size: 12,
      font,
      color: hex(CHROME.bg),
    });
  });
}

function hex(value: string): RGB {
  const n = parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** `color` mixed with white: `amount` 0.1 is a 10% tint. */
interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  /** Titles, headings and step numbers. */
  display: PDFFont;
}

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

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
const charSets = new WeakMap<PDFFont, Set<number>>();

function safeText(font: PDFFont, text: string): string {
  let cache = encodable.get(font);
  if (!cache) {
    cache = new Map();
    encodable.set(font, cache);
  }
  let out = '';
  for (const ch of text) {
    // Line breaks are laid out, never drawn.
    let ok = ch === '\n' ? true : cache.get(ch);
    if (ok === undefined) {
      try {
        font.encodeText(ch);
        // Embedded fonts do not throw for a missing character: check their character set.
        const set = charSets.get(font);
        ok = ch === '\n' || !set || set.has(ch.codePointAt(0) ?? 0);
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
  y: number;
  readonly pages: PDFPage[] = [];

  constructor(
    readonly pdf: PDFDocument,
    readonly geo: Geometry,
  ) {
    this.y = geo.TOP;
  }

  newPage(): void {
    this.page = this.pdf.addPage([this.geo.PAGE_W, this.geo.PAGE_H]);
    this.pages.push(this.page);
    this.y = this.geo.TOP;
  }

  /** Start a new page unless `height` fits below the cursor (a fresh page always "fits"). */
  ensure(height: number): void {
    if (this.y - height < this.geo.BOTTOM && this.y < this.geo.TOP) this.newPage();
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

/** A clickable area that opens `uri` (pdf-lib has no helper, so the annotation is built by hand). */
function linkAnnotation(
  pdf: PDFDocument,
  page: PDFPage,
  rect: [number, number, number, number],
  uri: string,
): void {
  const annot = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) },
  });
  page.node.addAnnot(pdf.context.register(annot));
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
 * pictures, headings, callouts and page numbers, drawn with the guide's brand (B2): its colours,
 * fonts, logo, cover style and order, header, footer, notice, page size and ShowSteps marks.
 */
export async function guideToPdf(input: ExportInput): Promise<Uint8Array> {
  const doc = exportDocument(input);
  const L = doc.labels;
  const brand = input.brand ?? resolveBrand(input.guide);
  const { header, footer, notice } = brand.page;
  const logoInHeader = !!input.logo && brand.logoPlacement !== 'cover';
  const logoOnCover = !!input.logo && brand.logoPlacement !== 'header';
  const headerLine = logoInHeader || !!(header.left || header.centre || header.right);
  const geo = pageGeometry(brand, headerLine);
  const { PAGE_W, PAGE_H, CONTENT_W, TOP, BOTTOM } = geo;
  const accentHex = brand.colors.accent;
  const accent = hex(accentHex);
  const onAccent = hex(textOn(accentHex));
  const links = hex(brand.colors.links);
  const headings = hex(brand.colors.headings);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const embedded = async (data: Uint8Array) => {
    const font = await pdf.embedFont(data, { subset: true });
    charSets.set(font, new Set(font.getCharacterSet()));
    return font;
  };
  /** A custom font's bytes (`custom:<asset>`), when the export was given them. */
  const customBytes = (name: string | undefined) =>
    name?.startsWith('custom:') ? input.fonts?.get(name.slice(7)) : undefined;
  const body = brand.fonts.body;
  const heading = brand.fonts.heading ?? body;
  const standard = async (name: string | undefined): Promise<Fonts> => {
    const serif = SERIF_FONTS.has(name ?? '');
    const bold = await pdf.embedFont(
      serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold,
    );
    return {
      regular: await pdf.embedFont(serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica),
      bold,
      italic: await pdf.embedFont(
        serif ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique,
      ),
      boldItalic: await pdf.embedFont(
        serif ? StandardFonts.TimesRomanBoldItalic : StandardFonts.HelveticaBoldOblique,
      ),
      display: bold,
    };
  };
  /** ShowSteps's own type: no font chosen, Funnel Sans, or a font this export can't use. */
  const own = (name: string | undefined) =>
    !name || name === 'Funnel Sans' || (!BRAND_FONTS[name] && !customBytes(name));
  let fonts: Fonts;
  const bodyCustom = customBytes(body);
  if (bodyCustom) {
    // A font the person added: one face for every style.
    const face = await embedded(bodyCustom);
    fonts = { regular: face, bold: face, italic: face, boldItalic: face, display: face };
  } else if (own(body)) {
    // ShowSteps's type, embedded (only the characters used). Funnel has no italic: italic
    // text uses the upright face, as many sans families do in PDFs.
    const regular = await embedded(bytes(PDF_SANS_400));
    const bold = await embedded(bytes(PDF_SANS_700));
    fonts = { regular, bold, italic: regular, boldItalic: bold, display: regular };
  } else fonts = await standard(body);
  // Titles, headings and step numbers.
  const headingCustom = customBytes(heading);
  if (headingCustom) fonts.display = await embedded(headingCustom);
  else if (own(heading)) fonts.display = await embedded(bytes(PDF_DISPLAY_800));
  else if (heading !== body) fonts.display = (await standard(heading)).display;
  const plainRuns = (text: string, font = fonts.regular, color = TEXT): Run[] => [
    { text, font, color },
  ];

  pdf.setTitle(doc.title, { showInWindowTitleBar: true });
  if (doc.description) pdf.setSubject(doc.description);
  const generator = brand.marks.generator === 'showsteps' ? 'ShowSteps' : (brand.company ?? '');
  pdf.setCreator(generator);
  pdf.setProducer(generator);
  pdf.setCreationDate(new Date(input.guide.createdAt));
  pdf.setModificationDate(new Date(input.guide.updatedAt));

  const w = new Writer(pdf, geo);

  // ---------- Cover: a band (pattern, solid or picture) or a plain page, in the kit's order ----
  w.newPage();
  const style = brand.cover.style;
  const order = coverOrder(brand);
  const titleInBand = style !== 'plain' && order.includes('title');
  if (style === 'plain') w.y = PAGE_H - MARGIN;
  else {
    const band = BAND[brand.cover.height];
    w.page.drawRectangle({
      x: 0,
      y: PAGE_H - band,
      width: PAGE_W,
      height: band,
      color: hex(brand.colors.coverBackground),
    });
    if (style === 'image' && input.coverImage) {
      // The picture fills the band, its middle showing.
      const pic = input.coverImage;
      const scale = Math.max(PAGE_W / pic.width, band / pic.height);
      const [pw, ph] = [pic.width * scale, pic.height * scale];
      const image = await embed(pdf, pic);
      const x = (PAGE_W - pw) / 2;
      const y = PAGE_H - band - (ph - band) / 2;
      w.page.drawImage(image, { x, y, width: pw, height: ph });
      // What reaches below the band is painted over: the rest of the cover is a white page.
      w.page.drawRectangle({
        x: 0,
        y: 0,
        width: PAGE_W,
        height: PAGE_H - band,
        color: hex(LIGHT.surface),
      });
    }
    if (style === 'pattern' && brand.marks.pattern)
      drawTrail(w.page, fonts.display, PAGE_W * 0.42, PAGE_H - band, PAGE_W * 0.58, band);
    if (input.logoOnDark) {
      const size = fit(input.logoOnDark, 160, 48);
      w.page.drawImage(await embed(pdf, input.logoOnDark), {
        x: MARGIN,
        y: PAGE_H - 28 - size.h,
        width: size.w,
        height: size.h,
      });
    }
    if (titleInBand) {
      const titleLines = layout(
        plainRuns(doc.title, fonts.display, hex(brand.colors.coverText)),
        26,
        style === 'pattern' && brand.marks.pattern ? PAGE_W * 0.5 : CONTENT_W,
      );
      w.y = PAGE_H - band / 2 + (titleLines.length * 32) / 2;
      w.lines(titleLines, MARGIN, 26, 32);
    }
    w.y = PAGE_H - band - 36;
  }
  for (const element of order) {
    if (element === 'title' && !titleInBand) {
      w.lines(layout(plainRuns(doc.title, fonts.display, headings), 26, CONTENT_W), MARGIN, 26, 32);
      w.y -= 16;
    } else if (element === 'links' && doc.links) {
      // "Open in ShowSteps: Guide Me · Run for me", the two names clickable (URI link annotations).
      const size = 11;
      const baseline = w.y - size;
      let x = MARGIN;
      const piece = (text: string, font: PDFFont, color: RGB, uri?: string) => {
        const width = font.widthOfTextAtSize(text, size);
        w.page.drawText(text, { x, y: baseline, size, font, color });
        if (uri) {
          w.page.drawLine({
            start: { x, y: baseline - 1.5 },
            end: { x: x + width, y: baseline - 1.5 },
            thickness: 0.6,
            color,
          });
          linkAnnotation(pdf, w.page, [x, baseline - 3, x + width, baseline + size], uri);
        }
        x += width;
      };
      piece(`${L.openIn} `, fonts.regular, TEXT);
      piece(L.guideMe, fonts.bold, links, doc.links.guide);
      piece('  ·  ', fonts.regular, MUTED);
      piece(L.runForMe, fonts.bold, links, doc.links.run);
      w.y -= size * 1.5;
      w.lines(layout(plainRuns(L.linksNote, fonts.regular, MUTED), 9, CONTENT_W), MARGIN, 9);
      w.y -= 18;
    } else if (element === 'logo' && logoOnCover && input.logo) {
      const logo = await embed(pdf, input.logo);
      const size = fit(input.logo, 200, 64);
      w.page.drawImage(logo, { x: MARGIN, y: w.y - size.h, width: size.w, height: size.h });
      w.y -= size.h + 24;
    } else if (element === 'description' && doc.description) {
      w.lines(layout(plainRuns(doc.description), 13, CONTENT_W), MARGIN, 13);
      w.y -= 8;
    } else if (element === 'meta') {
      w.lines(layout(plainRuns(doc.meta, fonts.regular, MUTED), 11, CONTENT_W), MARGIN, 11);
    } else if (element === 'preconditions') {
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
    }
  }

  // ---------- Body ----------
  w.newPage();
  if (!doc.items.length) w.lines(layout(plainRuns(L.noSteps), 12, CONTENT_W), MARGIN, 12);
  for (const item of doc.items) {
    if (item.kind === 'heading') {
      const lines = layout(plainRuns(item.text, fonts.display, headings), 18, CONTENT_W);
      w.y -= w.y < TOP ? 14 : 0;
      w.ensure(lines.length * 24 + 140); // keep a heading with what follows
      // Pink highlighter under the lower part of each line, as in the app.
      lines.forEach((line, i) => {
        w.page.drawRectangle({
          x: MARGIN,
          y: w.y - (i + 1) * 24 + 4,
          width: line.width,
          height: 7,
          color: hex(brand.colors.highlight),
          opacity: 0.35,
        });
      });
      w.lines(lines, MARGIN, 18, 24);
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
        color: hex(TONE_BG[item.tone]),
      });
      w.y -= 8;
      w.lines(lines, MARGIN + 16, 11);
      w.y -= 18;
    } else {
      const textW = CONTENT_W - INDENT;
      const title = layout(richRuns(item.title, fonts, TEXT, links), 12.5, textW);
      const desc = item.description
        ? layout(richRuns(item.description, fonts, MUTED, links), 10.5, textW)
        : [];
      const size = item.image ? fit(item.image, textW, MAX_IMAGE_H) : undefined;
      const height =
        title.length * 12.5 * 1.35 + desc.length * 10.5 * 1.35 + (size ? size.h + 12 : 0) + 6;
      w.ensure(Math.min(height, TOP - BOTTOM));
      const top = w.y;
      const numberStyle = brand.steps.numberStyle;
      if (numberStyle === 'circle')
        w.page.drawCircle({ x: MARGIN + 12, y: top - 9, size: 12, color: accent });
      else if (numberStyle === 'square')
        w.page.drawRectangle({ x: MARGIN, y: top - 21, width: 24, height: 24, color: accent });
      const num = String(item.number);
      const numSize = num.length > 2 ? 8.5 : 10.5;
      w.page.drawText(num, {
        x: MARGIN + 12 - fonts.display.widthOfTextAtSize(num, numSize) / 2,
        y: top - 9 - numSize * 0.36,
        size: numberStyle === 'plain' ? numSize + 2 : numSize,
        font: fonts.display,
        color: numberStyle === 'plain' ? accent : onAccent,
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
        if (brand.steps.pictureBorder)
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

  // U3: one visible line, and the procedure attached to the file as procedure.json (each one
  // a kit can leave out).
  if (brand.marks.agentLine) {
    w.ensure(30);
    w.y -= 12;
    w.lines(
      layout([{ text: L.agentFooter, font: fonts.regular, color: MUTED }], 9, CONTENT_W),
      MARGIN,
      9,
    );
  }
  if (brand.marks.agentData)
    await pdf.attach(strToU8(procedureJson(toProcedure(input.guide))), 'procedure.json', {
      mimeType: 'application/json',
      description: L.agentFooter,
      creationDate: new Date(input.guide.createdAt),
      modificationDate: new Date(input.guide.updatedAt),
    });

  // ---------- Header, footer and notice (every page after the cover) ----------
  const total = w.pages.length;
  const headerLogo = logoInHeader && input.logo ? await embed(pdf, input.logo) : undefined;
  w.pages.forEach((page, i) => {
    if (i === 0) return;
    const values = {
      title: doc.title,
      ...(brand.company ? { company: brand.company } : {}),
      page: i + 1,
      pages: total,
      date: doc.date,
      ...(input.guide.author ? { author: input.guide.author } : {}),
      pageOf: L.page(i + 1, total),
    };
    /** Three slots on one line: the left one gives way to the other two. */
    const slots = (row: { left: string; centre: string; right: string }, y: number, x0: number) => {
      const text = (t: string) => safeText(fonts.regular, expandTokens(t, values));
      const width = (t: string) => fonts.regular.widthOfTextAtSize(t, 9);
      const right = text(row.right);
      const centre = text(row.centre);
      const room =
        CONTENT_W - (x0 - MARGIN) - width(right) - (centre ? width(centre) + 24 : 0) - 24;
      let left = text(row.left);
      while (left.length > 1 && width(left) > room) left = `${left.slice(0, -2)}…`;
      if (left) page.drawText(left, { x: x0, y, size: 9, font: fonts.regular, color: MUTED });
      if (centre)
        page.drawText(centre, {
          x: MARGIN + (CONTENT_W - width(centre)) / 2,
          y,
          size: 9,
          font: fonts.regular,
          color: MUTED,
        });
      if (right)
        page.drawText(right, {
          x: MARGIN + CONTENT_W - width(right),
          y,
          size: 9,
          font: fonts.regular,
          color: MUTED,
        });
    };
    if (headerLine) {
      const y = PAGE_H - MARGIN - 9;
      let x0 = MARGIN;
      if (headerLogo && input.logo) {
        const size = fit(input.logo, 120, 18);
        page.drawImage(headerLogo, { x: MARGIN, y: y - 4, width: size.w, height: size.h });
        x0 += size.w + 10;
      }
      slots(header, y, x0);
    }
    page.drawLine({
      start: { x: MARGIN, y: MARGIN + 14 },
      end: { x: MARGIN + CONTENT_W, y: MARGIN + 14 },
      thickness: 0.5,
      color: BORDER,
    });
    slots(footer, MARGIN, MARGIN);
    if (notice) {
      const line = safeText(fonts.bold, notice);
      page.drawText(line, {
        x: MARGIN + (CONTENT_W - fonts.bold.widthOfTextAtSize(line, 8.5)) / 2,
        y: MARGIN + 20,
        size: 8.5,
        font: fonts.bold,
        color: MUTED,
      });
    }
  });

  return pdf.save();
}

/** The procedure JSON attached to a PDF made by ShowSteps, if it has one. */
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
