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
export { collectPageText, type CollectOptions } from './dom/text.js';
export { pageState, expectationsFrom, type PageState } from './dom/observe.js';
export {
  scaleRect,
  offsetRect,
  roundRect,
  clampRect,
  intersects,
  actionBoxFor,
  autoCrop,
  focusRect,
  MIN_CROP_WIDTH,
  fitWidth,
  type AutoCrop,
} from './geometry.js';

// Archives
export {
  ARCHIVE_ACCEPT,
  ARCHIVE_EXTENSION,
  exportGuideArchive,
  type ArchiveOptions,
  type RedactedImage,
  type Redactor,
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
  HIGHLIGHT_ALT_COLOR,
  isHexColor,
  textOn,
  luminance,
  contrastRatio,
  accentOf,
  fontOf,
} from './branding.js';
export {
  LIGHT,
  DARK,
  CHROME,
  CHROME_EFFECTS,
  ANNOTATION_COLORS,
  ANNOTATION_HALO,
  SPOTLIGHT,
  chromeTokenCss,
} from './tokens.js';
export {
  rippleSvg,
  trailSvg,
  trailGeometry,
  type PatternOptions,
  type TrailGeometry,
} from './patterns.js';
export { ringBlendsIn, navyRing, type HighlightChoice } from './highlight.js';

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
  planGuideStep,
  guideSteps,
  attachSourceValid,
  attachAhead,
  runFields,
  valueFor,
  type StepPlan,
  type AttachSource,
  type RunField,
} from './guidance/plan.js';
export {
  MAX_LINK_ID,
  guideStartUrl,
  buildStartLink,
  parseStartLink,
  withoutStartLink,
  type StartLink,
  type StartMode,
} from './guidance/links.js';
export { looksLikeDownload, suggestAttachSource, setAttachSource } from './guidance/attach.js';
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
  urlMatches,
} from './dom/act.js';
export { fileInputFor, acceptsFile, attachProblem, setInputFile } from './dom/attach.js';

// Schedules (local to the browser profile; never inside guides or exports)
export {
  RecurrenceSchema,
  ScheduleSchema,
  RunStepLogSchema,
  RunLogSchema,
  RUN_OUTCOMES,
  MAX_RUN_LOGS,
  SCHEDULE_DEFAULTS,
  runLogsToDrop,
  parseSchedules,
  type Recurrence,
  type Schedule,
  type RunLog,
  type RunStepLog,
  type RunOutcome,
} from './schedule/schema.js';
export { nextRun, nextRuns, missedRun, occursOn } from './schedule/recurrence.js';
export {
  PLACEHOLDERS,
  DEFAULT_DATE_FORMAT,
  UnknownPlaceholderError,
  unknownPlaceholders,
  hasPlaceholders,
  isDateFormat,
  formatDate as formatScheduleDate,
  placeholderDate,
  resolveTokens,
  type Placeholder,
} from './schedule/placeholders.js';
export { guideVersion, activeApprovals, approvalsOutdated } from './schedule/version.js';
export {
  canSchedule,
  needsPerson,
  createSchedule,
  withApprovals,
  resolveValues,
} from './schedule/create.js';
export { SIGN_IN_HOSTS, hostMatches, isSignInHost, needsSignIn } from './schedule/signin.js';
export {
  zone,
  systemZone,
  daysInMonth,
  weekday,
  addDays,
  isoDate,
  isBusinessDay,
  type Zone,
  type LocalDate,
  type LocalDateTime,
} from './schedule/zone.js';

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

// Extension ↔ desktop bridge protocol
export {
  BRIDGE_HOST,
  BRIDGE_VERSION,
  BRIDGE_STORE_METHODS,
  CHUNK_CHARS,
  PartCollector,
  decodeMessage,
  encodeMessage,
  fromBase64,
  splitMessage,
  type BridgeEvent,
  type BridgePart,
  type BridgeReply,
  type BridgeRequest,
  type BridgeStoreMethod,
  BRIDGE_CAPABILITIES,
  type BridgeCapability,
  type HelloReply,
} from './bridge.js';
export { toBase64 } from './export/model.js';
export {
  REMOTE_PROCESSES,
  BROWSER_PROCESSES,
  isRemoteProcess,
  isBrowserProcess,
} from './desktop.js';
export {
  TextRunSchema,
  PageTextSchema,
  type TextRun,
  type PageText,
  type SensitiveKind,
  type SensitiveMatch,
  type SensitiveFinding,
  type DetectOptions,
  wordsFileFor,
  parsePageText,
  serializePageText,
  scalePageText,
  luhn,
  validTfn,
  validAbn,
  validIban,
  detectSensitive,
  findSensitiveOnPage,
  maskValue,
  alreadyBlurred,
  applySecureBlur,
} from './secure.js';
export { needsConfirm, isIrreversibleName } from './agent/confirm.js';
export {
  valueKind,
  suggestAsk,
  variableName,
  fieldLabel,
  setInputMode,
  markSensitive,
  type ValueKind,
} from './agent/variables.js';
export {
  toProcedure,
  procedureJson,
  LEGACY_PROCEDURE_FORMATS,
  PROCEDURE_FORMAT,
  isProcedureFormat,
  DEFAULT_ON_FAILURE,
  type Procedure,
  type ProcedureStep,
  type ProcedureTarget,
  type ProcedureVariable,
} from './agent/procedure.js';
export {
  agentWarnings,
  stepWarnings,
  hasStableSelector,
  STABLE_SCORE,
  type AgentWarning,
  type AgentWarningKind,
} from './agent/warnings.js';
