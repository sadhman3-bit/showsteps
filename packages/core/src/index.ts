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
export { summarize, thumbNameFor } from './storage/summary.js';

// Capture
export {
  CaptureSession,
  attachScreenshot,
  type CaptureEvent,
  type ApplyResult,
  type ElementKey,
  type ShotInfo,
} from './capture/session.js';
export { isSensitiveField, isTextEntry } from './dom/sensitive.js';
export {
  scaleRect,
  offsetRect,
  roundRect,
  clampRect,
  intersects,
  actionBoxFor,
  autoCrop,
  fitWidth,
  type AutoCrop,
} from './geometry.js';

// Archives
export {
  ARCHIVE_EXTENSION,
  exportGuideArchive,
  importGuideArchive,
  duplicateGuide,
  type ImportResult,
} from './archive.js';

// Editing
export * from './editor/ops.js';
export { History } from './editor/history.js';
export {
  withOriginal,
  resetImage,
  withMagnify,
  bulkBlurCandidates,
  applyBlurToSteps,
} from './editor/image.js';

// Branding
export {
  BRAND_FONTS,
  SERIF_FONTS,
  DEFAULT_ACCENT,
  HIGHLIGHT_COLOR,
  isHexColor,
  textOn,
  accentOf,
  fontOf,
} from './branding.js';

// Guidance (Guide Me, Run for me, Discover, notes and pins, comments, analytics)
export { pageKey, originOf, samePage, relevantGuides } from './guidance/pages.js';
export {
  PageMarkSchema,
  PageMarksSchema,
  marksForUrl,
  parseMarks,
  type PageMark,
} from './guidance/marks.js';
export {
  planStep,
  guideSteps,
  runFields,
  valueFor,
  type StepPlan,
  type RunField,
} from './guidance/plan.js';
export {
  END_OF_GUIDE,
  REACTIONS,
  CommentsSidecarSchema,
  emptyComments,
  parseComments,
  mergeThreads,
  toggleReaction,
  type Comment,
  type CommentsSidecar,
  type Thread,
  type ThreadComment,
} from './guidance/social.js';
export {
  MAX_RUNS,
  AnalyticsSidecarSchema,
  parseAnalytics,
  recordView,
  recordRun,
  guideStats,
  type AnalyticsSidecar,
  type Run,
  type GuideStats,
} from './guidance/analytics.js';
export {
  performStep,
  canPerform,
  setValue,
  selectOption,
  pressKey,
  failedExpectations,
} from './dom/act.js';

// On-device AI helpers (prompts and results only)
export {
  fromMarkdown,
  IMPROVE_SYSTEM_PROMPT,
  improvePrompt,
  parseImproved,
  summaryInput,
  translatableTexts,
  translatedCopy,
} from './ai.js';
