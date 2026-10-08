export { SCHEMA_VERSION, PRODUCT_NAME } from './version.js';
export * from './schema.js';
export { createId, nowIso } from './ids.js';
export {
  plain,
  toPlainText,
  toMarkdown,
  toHtml,
  escapeHtml,
  normalize as normalizeRichText,
} from './richText.js';
export {
  MIGRATIONS,
  GuideFormatError,
  migrateRaw,
  parseGuide,
  serializeGuide,
  type Migration,
} from './migrations.js';
export {
  DEFAULT_TIMEOUT_MS,
  createGuide,
  createStep,
  createHeading,
  createCallout,
  type StepInit,
} from './factory.js';
export { writeStepTitle, targetLabel, cleanName } from './stepText.js';

// DOM helpers (take nodes as arguments; no DOM globals at import)
export {
  getRole,
  getAccessibleName,
  labelText,
  visibleText,
  normalizeText,
  isFormControl,
} from './dom/aria.js';
export { describeElement, toActionable, type DescribeOptions } from './dom/describe.js';
export {
  findTarget,
  waitForTarget,
  resolveScope,
  selectorsFor,
  textSimilarity,
  defaultVisible,
  STRATEGY_ORDER,
  type MatchOptions,
  type MatchResult,
  type MatchStrategy,
  type WaitOptions,
} from './dom/match.js';
export {
  deepElements,
  shadowHosts,
  cssPath,
  xpathOf,
  resolveXPath,
  frameSelector,
} from './dom/traverse.js';

// Storage
export * from './storage/types.js';
export { FolderStore, type FileSystem } from './storage/folder.js';
export { IndexedDbStore } from './storage/indexeddb.js';
export { summarize } from './storage/summary.js';
