// Exporters (X1–X6). A separate entry point (`@trailmark/core/export`) so apps can load the
// PDF and Word libraries only when someone exports.
export { EXPORT_LABELS, formatDate, type ExportLabels } from './labels.js';
export {
  exportDocument,
  extensionFor,
  dataUri,
  toBase64,
  type ExportImage,
  type ExportInput,
  type ExportItem,
  type ExportDocument,
} from './model.js';
export { guideToMarkdown, guideToMarkdownZip } from './markdown.js';
export { guideToHtml, guideToEmbedHtml, guideToClipboardHtml, guideToText } from './html.js';
export { guideToPdf } from './pdf.js';
export { guideToDocx } from './docx.js';
