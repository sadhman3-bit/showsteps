import { stepNumbers } from '../editor/ops.js';
import { toPlainText } from '../richText.js';
import type { CalloutTone, Guide, RichText } from '../schema.js';
import { EXPORT_LABELS, formatDate, type ExportLabels } from './labels.js';

/** A finished picture for export: crop, blurs, highlight and annotations already burned in. */
export interface ExportImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  mime: 'image/png' | 'image/jpeg';
}

export interface ExportInput {
  guide: Guide;
  /** Flattened step pictures by step id. Steps without one export as text only. */
  images: ReadonlyMap<string, ExportImage>;
  logo?: ExportImage;
  labels?: ExportLabels;
}

export type ExportItem =
  | { kind: 'heading'; id: string; text: string; anchor: string }
  | { kind: 'callout'; id: string; tone: CalloutTone; label: string; text: string }
  | {
      kind: 'step';
      id: string;
      number: number;
      anchor: string;
      title: RichText;
      titleText: string;
      description?: RichText;
      alt: string;
      image?: ExportImage;
      /** File name inside an export folder, e.g. `step-03.png`. */
      imageName?: string;
    };

export interface ExportDocument {
  title: string;
  description?: string;
  preconditions: string[];
  success?: string;
  /** "17 steps · Updated 10 October 2026" */
  meta: string;
  stepCount: number;
  items: ExportItem[];
  labels: ExportLabels;
}

export function extensionFor(image: ExportImage): string {
  return image.mime === 'image/jpeg' ? 'jpg' : 'png';
}

/** The guide flattened into what every exporter writes, in order, with numbers and alt text. */
export function exportDocument(input: ExportInput): ExportDocument {
  const labels = input.labels ?? EXPORT_LABELS;
  const { guide } = input;
  const numbers = stepNumbers(guide);
  const width = String(numbers.size).length < 2 ? 2 : String(numbers.size).length;
  let section = 0;
  const items = guide.blocks.map((b): ExportItem => {
    if (b.kind === 'heading') {
      section += 1;
      return { kind: 'heading', id: b.id, text: b.text, anchor: `section-${section}` };
    }
    if (b.kind === 'callout') {
      return { kind: 'callout', id: b.id, tone: b.tone, label: labels.tone[b.tone], text: b.text };
    }
    const number = numbers.get(b.id) ?? 0;
    const titleText = toPlainText(b.human.title);
    const image = input.images.get(b.id);
    return {
      kind: 'step',
      id: b.id,
      number,
      anchor: `step-${number}`,
      title: b.human.title,
      titleText,
      ...(b.human.description?.spans.length ? { description: b.human.description } : {}),
      alt: b.human.altText?.trim() || labels.screenshotAlt(number, titleText),
      ...(image
        ? {
            image,
            imageName: `step-${String(number).padStart(width, '0')}.${extensionFor(image)}`,
          }
        : {}),
    };
  });
  const date = formatDate(guide.updatedAt, labels);
  return {
    title: guide.title,
    ...(guide.description?.trim() ? { description: guide.description.trim() } : {}),
    preconditions: guide.preconditions.filter((p) => p.trim()),
    ...(guide.success?.trim() ? { success: guide.success.trim() } : {}),
    meta: [labels.steps(numbers.size), date ? labels.updated(date) : '']
      .filter(Boolean)
      .join(' · '),
    stepCount: numbers.size,
    items,
    labels,
  };
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without relying on `btoa` or `Buffer`, so exporters run anywhere. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out +=
      BASE64.charAt(n >> 18) +
      BASE64.charAt((n >> 12) & 63) +
      BASE64.charAt((n >> 6) & 63) +
      BASE64.charAt(n & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += BASE64.charAt(n >> 18) + BASE64.charAt((n >> 12) & 63) + '==';
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out +=
      BASE64.charAt(n >> 18) + BASE64.charAt((n >> 12) & 63) + BASE64.charAt((n >> 6) & 63) + '=';
  }
  return out;
}

export function dataUri(image: ExportImage): string {
  return `data:${image.mime};base64,${toBase64(image.bytes)}`;
}
