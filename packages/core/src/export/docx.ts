import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  TabStopType,
  TextRun,
} from 'docx';
import fontkit from '@pdf-lib/fontkit';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PROCEDURE_FORMAT, procedureJson, toProcedure } from '../agent/procedure.js';
import { BRAND_FONTS } from '../branding.js';
import { coverOrder, expandTokens, resolveBrand, type TokenValues } from '../brandkit.js';
import { LIGHT } from '../tokens.js';
import { PDF_DISPLAY_800, PDF_SANS_400 } from './fonts.generated.js';
import type { RichText } from '../schema.js';
import { exportDocument, type ExportImage, type ExportInput } from './model.js';

/** Word colours are hex without the #. */
const word = (hex: string) => hex.slice(1).toUpperCase();
const TONES = {
  tip: word(LIGHT.tip),
  note: word(LIGHT.note),
  warning: word(LIGHT.warning),
  alert: word(LIGHT.alert),
};
const TONE_FILL = {
  tip: word(LIGHT.tipBg),
  note: word(LIGHT.noteBg),
  warning: word(LIGHT.warningBg),
  alert: word(LIGHT.alertBg),
};
const MUTED = word(LIGHT.textMuted);

const base64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
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
  const brand = input.brand ?? resolveBrand(input.guide);
  const accent = word(brand.colors.accent);
  const headings = word(brand.colors.headings);
  // ShowSteps's own type, embedded in the file, unless the brand picks a font; a font the
  // person added is embedded under its own family name.
  const embeddedFonts: { name: string; data: Buffer }[] = [];
  const family = (name: string | undefined, own: string): string => {
    const custom = name?.startsWith('custom:') ? input.fonts?.get(name.slice(7)) : undefined;
    if (custom) {
      let familyName = 'Custom';
      try {
        familyName = (fontkit.create(custom) as { familyName?: string }).familyName ?? familyName;
      } catch {
        // An unreadable font: Word falls back to its own.
      }
      if (!embeddedFonts.some((f) => f.name === familyName))
        embeddedFonts.push({ name: familyName, data: custom as Buffer });
      return familyName;
    }
    if (!name || name === 'Funnel Sans' || !BRAND_FONTS[name]) {
      if (!embeddedFonts.some((f) => f.name === own))
        embeddedFonts.push({
          name: own,
          data: base64(own === 'Funnel Sans' ? PDF_SANS_400 : PDF_DISPLAY_800) as Buffer,
        });
      return own;
    }
    return name;
  };
  const font = family(brand.fonts.body, 'Funnel Sans');
  const headingFont = family(brand.fonts.heading ?? brand.fonts.body, 'Funnel Display');
  const children: Paragraph[] = [];
  const logoOnCover = !!input.logo && brand.logoPlacement !== 'header';

  for (const element of coverOrder(brand)) {
    if (element === 'logo' && logoOnCover && input.logo) {
      children.push(
        new Paragraph({
          children: [imageRun(input.logo, 240, 56, 'Logo', '')],
          spacing: { after: 240 },
        }),
      );
    } else if (element === 'title') {
      children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: textRuns(doc.title) }));
    } else if (element === 'links' && doc.links) {
      const link = (href: string, text: string) =>
        new ExternalHyperlink({
          link: href,
          children: [new TextRun({ text, style: 'Hyperlink', bold: true })],
        });
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${L.openIn} ` }),
            link(doc.links.guide, L.guideMe),
            new TextRun({ text: ' · ' }),
            link(doc.links.run, L.runForMe),
          ],
        }),
        new Paragraph({ children: textRuns(L.linksNote, { color: MUTED }) }),
      );
    } else if (element === 'description' && doc.description) {
      children.push(new Paragraph({ children: textRuns(doc.description) }));
    } else if (element === 'meta') {
      children.push(new Paragraph({ children: textRuns(doc.meta, { color: MUTED }) }));
    } else if (element === 'preconditions' && doc.preconditions.length) {
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
          // Tinted box with the same colour as its border: no coloured stripe on one side.
          border: {
            top: { style: BorderStyle.SINGLE, size: 6, color: TONE_FILL[item.tone], space: 6 },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: TONE_FILL[item.tone], space: 6 },
            left: { style: BorderStyle.SINGLE, size: 6, color: TONE_FILL[item.tone], space: 8 },
            right: { style: BorderStyle.SINGLE, size: 6, color: TONE_FILL[item.tone], space: 8 },
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

  // U3: one visible line; the procedure itself goes into a custom XML part (below). A kit can
  // leave either out.
  if (brand.marks.agentLine)
    children.push(
      new Paragraph({
        spacing: { before: 360 },
        children: [new TextRun({ text: L.agentFooter, color: MUTED, size: 16 })],
      }),
    );

  // Header and footer slots, with live page fields for {page}, {pages} and {pageOf}.
  const values: Omit<TokenValues, 'page' | 'pages' | 'pageOf'> = {
    title: doc.title,
    ...(brand.company ? { company: brand.company } : {}),
    date: doc.date,
    ...(input.guide.author ? { author: input.guide.author } : {}),
  };
  const fieldParts = (
    template: string,
  ): (string | (typeof PageNumber)[keyof typeof PageNumber])[] =>
    template
      .split(/(\{page\}|\{pages\}|\{pageOf\})/)
      .filter(Boolean)
      .flatMap((part) =>
        part === '{page}'
          ? [PageNumber.CURRENT]
          : part === '{pages}'
            ? [PageNumber.TOTAL_PAGES]
            : part === '{pageOf}'
              ? fieldParts(L.page(-1, -2).replace('-1', '{page}').replace('-2', '{pages}'))
              : [expandTokens(part, { ...values, page: 0, pages: 0, pageOf: '' })],
      );
  // Content width in twips (A4 or Letter, less the margins): centre and right tab stops.
  const [pageW, pageH] = brand.page.size === 'Letter' ? [12240, 15840] : [11906, 16838];
  const contentW = pageW - 1134 * 2;
  const slotParagraph = (row: { left: string; centre: string; right: string }) =>
    new Paragraph({
      tabStops: [
        { type: TabStopType.CENTER, position: contentW / 2 },
        { type: TabStopType.RIGHT, position: contentW },
      ],
      children: [
        new TextRun({ children: fieldParts(row.left), color: MUTED, size: 18 }),
        new TextRun({ children: ['\t', ...fieldParts(row.centre)], color: MUTED, size: 18 }),
        new TextRun({ children: ['\t', ...fieldParts(row.right)], color: MUTED, size: 18 }),
      ],
    });
  const { header, footer, notice } = brand.page;
  const headerLogo = !!input.logo && brand.logoPlacement !== 'cover';
  const hasHeader = headerLogo || !!(header.left || header.centre || header.right);

  const file = new Document({
    creator: brand.marks.generator === 'showsteps' ? 'ShowSteps' : (brand.company ?? ''),
    ...(embeddedFonts.length ? { fonts: embeddedFonts } : {}),
    title: doc.title,
    ...(doc.description ? { description: doc.description } : {}),
    styles: {
      default: {
        document: { run: { font, size: 21 }, paragraph: { spacing: { after: 80 } } },
        title: { run: { font: headingFont, size: 52, bold: true, color: headings } },
        heading1: {
          run: { font: headingFont, size: 32, bold: true, color: headings },
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
            size: { width: pageW, height: pageH }, // A4 or Letter
            margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
          },
        },
        ...(hasHeader
          ? {
              headers: {
                default: new Header({
                  children: [
                    ...(headerLogo && input.logo
                      ? [new Paragraph({ children: [imageRun(input.logo, 120, 24, 'Logo', '')] })]
                      : []),
                    ...(header.left || header.centre || header.right
                      ? [slotParagraph(header)]
                      : []),
                  ],
                }),
              },
            }
          : {}),
        footers: {
          default: new Footer({
            children: [
              ...(notice
                ? [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: notice, bold: true, color: MUTED, size: 17 })],
                    }),
                  ]
                : []),
              slotParagraph(footer),
            ],
          }),
        },
        children,
      },
    ],
  });
  const packed = new Uint8Array(await Packer.toArrayBuffer(file));
  return brand.marks.agentData
    ? withProcedurePart(packed, procedureJson(toProcedure(input.guide)))
    : packed;
}

export const PROCEDURE_XML_NAMESPACE = 'urn:showsteps:procedure:v1';
const CUSTOM_XML_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml';
const CUSTOM_PROPS_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps';

const xmlText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Add `customXml/item1.xml` (the procedure JSON inside a `<procedure>` element), its
 * properties part and the relationships, the standard place for data a document carries.
 */
export function withProcedurePart(docx: Uint8Array, json: string): Uint8Array {
  const files = unzipSync(docx);
  const id = '{6F1D3C1E-7A2B-4C55-9E21-54524C4D4B31}';
  files['customXml/item1.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<procedure xmlns="${PROCEDURE_XML_NAMESPACE}" format="${PROCEDURE_FORMAT}" schemaVersion="1">${xmlText(json)}</procedure>`,
  );
  files['customXml/itemProps1.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<ds:datastoreItem ds:itemID="${id}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="${PROCEDURE_XML_NAMESPACE}"/></ds:schemaRefs></ds:datastoreItem>`,
  );
  files['customXml/_rels/item1.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${CUSTOM_PROPS_REL}" Target="itemProps1.xml"/></Relationships>`,
  );
  const typesFile = files['[Content_Types].xml'];
  const relsFile = files['word/_rels/document.xml.rels'];
  if (!typesFile || !relsFile) return docx;
  const types = strFromU8(typesFile);
  files['[Content_Types].xml'] = strToU8(
    types.replace(
      '</Types>',
      '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>',
    ),
  );
  const relsPath = 'word/_rels/document.xml.rels';
  const rels = strFromU8(relsFile);
  files[relsPath] = strToU8(
    rels.replace(
      '</Relationships>',
      `<Relationship Id="rIdShowStepsProcedure" Type="${CUSTOM_XML_REL}" Target="../customXml/item1.xml"/></Relationships>`,
    ),
  );
  return zipSync(files, { level: 6 });
}

/** The procedure JSON from a Word file made by ShowSteps, if it has one. */
export function procedureFromDocx(docx: Uint8Array): string | undefined {
  const item = unzipSync(docx)['customXml/item1.xml'];
  if (!item) return undefined;
  const m = /<procedure[^>]*>([\s\S]*)<\/procedure>/.exec(strFromU8(item));
  return m?.[1]?.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
