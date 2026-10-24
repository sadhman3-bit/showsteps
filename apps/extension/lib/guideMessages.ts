// Messages for guidance (Guide Me, Run for me), notes and pins, validated with Zod on receipt.
import {
  InputModeSchema,
  PageMarkSchema,
  ScheduleSchema,
  StepSchema,
  TargetSchema,
} from '@showsteps/core';
import { z } from 'zod';

export const SpeedSchema = z.enum(['slow', 'normal', 'fast']);
export type Speed = z.infer<typeof SpeedSchema>;

/** Which file an attach step wants, for messages: its name when known, and the step it came from. */
export const FileHintSchema = z.object({
  name: z.string().max(255).optional(),
  step: z.number().int().positive().optional(),
  /** `file-other-site`: the host the file came from and the step's own (H3). */
  from: z.string().max(255).optional(),
  site: z.string().max(255).optional(),
});
export type FileHint = z.infer<typeof FileHintSchema>;

/** A file going to or coming from a page: base64 (the 25 MB cap keeps it under Chrome's limit). */
export const FilePayloadSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.string().max(255),
  data: z.string(),
});
export type FilePayload = z.infer<typeof FilePayloadSchema>;

export const GuidanceStateSchema = z.object({
  status: z.enum(['idle', 'active', 'done']),
  mode: z.enum(['guide', 'run']),
  guideId: z.string().optional(),
  title: z.string().optional(),
  tabId: z.number().int().optional(),
  /** Current step, 0-based among the guide's steps. */
  index: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /**
   * finding: looking for the target · showing: highlighted, waiting for the person ·
   * not-found: target missing · manual: the person does this step · navigate: open a page ·
   * confirm: Run for me waits for approval · acting: Run for me is doing the step ·
   * paused · failed: Run for me could not do the step or an expectation failed.
   */
  phase: z.enum([
    'finding',
    'showing',
    'not-found',
    'manual',
    'navigate',
    'confirm',
    'acting',
    'paused',
    'failed',
  ]),
  reason: z.string().optional(),
  /** The file an attach step waits for or couldn't attach (with a `file-…` reason). */
  file: FileHintSchema.optional(),
  speed: SpeedSchema,
  stepThrough: z.boolean(),
  /** Set while Run for me runs for a schedule (in its own window). */
  scheduleId: z.string().optional(),
});
export type GuidanceState = z.infer<typeof GuidanceStateSchema>;

export const GUIDANCE_IDLE: GuidanceState = {
  status: 'idle',
  mode: 'guide',
  index: 0,
  total: 0,
  phase: 'finding',
  speed: 'normal',
  stepThrough: false,
};

export const GuideControlSchema = z.enum([
  'next',
  'back',
  'skip',
  'stop',
  'pause',
  'resume',
  'confirm',
  'retry',
  'step',
]);
export type GuideControl = z.infer<typeof GuideControlSchema>;

const Values = z.record(z.string().max(200), z.string().max(10_000));

export const SettingsSchema = z.object({
  /** Shown on comments and used to name per-user files. */
  userName: z.string().min(1).max(100),
  /** Notes, pins and Discover suggestions on pages. */
  guidanceEnabled: z.boolean(),
  /** Optional on-device AI (off by default). */
  aiEnabled: z.boolean(),
  /** Connect to the ShowSteps desktop app (native messaging). */
  desktopApp: z.boolean(),
  /** Keep guides in the desktop app's library instead of browser storage. */
  desktopLibrary: z.boolean(),
  /** The move-to-desktop question was answered. */
  desktopAsked: z.boolean(),
  /** How typed values in new guides are used (U4): fixed, ask every run, ask with a default. */
  defaultInputMode: InputModeSchema,
  /** Colours of ShowSteps's pages. */
  theme: z.enum(['system', 'light', 'dark']),
  /** Live Blur is on when a capture starts. */
  liveBlurDefault: z.boolean(),
  /** How far a step's picture zooms in on the action (1 = whole screen, no auto-crop). */
  magnify: z.union([z.literal(1), z.literal(1.5), z.literal(2), z.literal(3)]),
  /** Picture quality: high keeps fine text crisp; standard makes smaller files. */
  screenshotQuality: z.enum(['high', 'standard']),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = {
  userName: 'Me',
  guidanceEnabled: true,
  aiEnabled: false,
  desktopApp: false,
  desktopLibrary: false,
  desktopAsked: false,
  defaultInputMode: 'fixed',
  theme: 'system',
  liveBlurDefault: false,
  magnify: 2,
  screenshotQuality: 'high',
};
export const SETTINGS_KEY = 'settings';
export const MARKS_KEY = 'marks';

/** Messages from extension pages. */
export const GuidePageMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('guide-start'),
    guideId: z.string().min(1),
    mode: z.enum(['guide', 'run']),
    /** Use this tab (else the current tab if it is already on the first page, else a new tab). */
    tabId: z.number().int().optional(),
    windowId: z.number().int().optional(),
    values: Values.optional(),
    speed: SpeedSchema.optional(),
    stepThrough: z.boolean().optional(),
    /** Start at this step (0-based). */
    from: z.number().int().nonnegative().optional(),
    /** Started from a link in an exported file (1.2): the tab goes to the start page first. */
    fromLink: z.boolean().optional(),
  }),
  /** The start window's Not now (1.2): take the ShowSteps marker out of the tab's address. */
  z.object({ type: z.literal('start-link-dismiss'), tabId: z.number().int() }),
  z.object({ type: z.literal('guide-control'), action: GuideControlSchema }),
  z.object({ type: z.literal('guide-goto'), index: z.number().int().nonnegative() }),
  /** U9: the current step could not be found; record it again in place. */
  z.object({ type: z.literal('guide-recapture') }),
  /** U7: dry-run a guide in a new tab and report each step's element. */
  z.object({ type: z.literal('guide-selfcheck'), guideId: z.string().min(1) }),
  z.object({ type: z.literal('guide-speed'), speed: SpeedSchema, stepThrough: z.boolean() }),
  z.object({ type: z.literal('guide-get') }),
  z.object({ type: z.literal('mark-save'), mark: PageMarkSchema }),
  z.object({ type: z.literal('mark-delete'), id: z.string().min(1) }),
  /** Let the person click an element on the page to attach a note or pin. */
  z.object({ type: z.literal('pick-start'), tabId: z.number().int() }),
  z.object({ type: z.literal('pick-cancel'), tabId: z.number().int() }),
  z.object({ type: z.literal('settings-changed') }),
  /** Desktop app connection status (and reconnect if the setting changed). */
  z.object({ type: z.literal('desktop-get') }),
  /** Schedules (S2): pages read schedules and run logs directly; changes go through here. */
  z.object({ type: z.literal('schedule-save'), schedule: ScheduleSchema }),
  z.object({ type: z.literal('schedule-delete'), id: z.string().min(1) }),
  z.object({ type: z.literal('schedule-enable'), id: z.string().min(1), enabled: z.boolean() }),
  z.object({ type: z.literal('schedule-run'), id: z.string().min(1) }),
  /** The Schedules page was opened: clear the toolbar badge. */
  z.object({ type: z.literal('schedule-seen') }),
]);
export type GuidePageMessage = z.infer<typeof GuidePageMessageSchema>;

/** Messages from content scripts. */
export const GuideContentMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('guide-hello') }),
  /** The person did the highlighted step. */
  z.object({ type: z.literal('guide-done'), stepId: z.string().min(1) }),
  z.object({ type: z.literal('guide-control'), action: GuideControlSchema }),
  z.object({
    type: z.literal('picked'),
    target: TargetSchema.optional(),
    cancelled: z.boolean().optional(),
  }),
  /** A pin or note asked to open its guide. */
  z.object({
    type: z.literal('open-guide'),
    guideId: z.string().min(1),
    mode: z.enum(['view', 'guide']),
  }),
]);
export type GuideContentMessage = z.infer<typeof GuideContentMessageSchema>;

/** From the background to a frame. */
export const GuideToContentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('guide-show'),
    step: StepSchema,
    number: z.number().int().positive(),
    total: z.number().int().positive(),
    /** What the tooltip offers: Guide Me waits for the person; Run for me asks to confirm. */
    phase: z.enum(['showing', 'manual', 'confirm']),
    timeoutMs: z.number().int().positive(),
    /** An attach step: which file to choose. */
    hint: FileHintSchema.optional(),
  }),
  z.object({
    type: z.literal('guide-run'),
    step: StepSchema,
    value: z.string().max(10_000).optional(),
    speed: SpeedSchema,
    timeoutMs: z.number().int().positive(),
    /**
     * A later step attaches this click's download: read a `blob:` or `data:` link's file first
     * (and, with `fetchLink`, a same-site link with a `download` attribute).
     */
    grab: z.object({ fetchLink: z.boolean() }).optional(),
    /** An attach step: put this file in the step's file field. */
    attach: FilePayloadSchema.optional(),
  }),
  z.object({ type: z.literal('guide-clear') }),
  /** Top frame: scroll the iframe that holds the next target into view. */
  z.object({
    type: z.literal('guide-frame'),
    frames: z.array(z.string().max(2000)).max(10),
    frameUrl: z.string().max(4096),
  }),
  z.object({ type: z.literal('guide-check'), step: StepSchema }),
  /** U7 self-check: find the step's element and highlight it, without acting. */
  z.object({
    type: z.literal('guide-probe'),
    step: StepSchema,
    timeoutMs: z.number().int().positive(),
    /** An upload step: find its file field, which may be hidden behind a button (1.2). */
    fileField: z.boolean().optional(),
  }),
  z.object({ type: z.literal('marks-changed') }),
  z.object({ type: z.literal('pick'), on: z.boolean() }),
  /** Top frame: does this page look like a sign-in page? (Run for me could not find a step.) */
  z.object({ type: z.literal('guide-signin') }),
  /** Top frame: a message across the page with its button (cleared by guide-clear). */
  z.object({ type: z.literal('guide-notice'), kind: z.enum(['sign-in']) }),
]);
export type GuideToContent = z.infer<typeof GuideToContentSchema>;

export const ShowReplySchema = z.object({ found: z.boolean() });
export const RunReplySchema = z.object({
  result: z.enum(['acted', 'not-found', 'cannot']),
  /** `file-type`: the field doesn't take this file (or is disabled). */
  reason: z.enum(['file-type']).optional(),
  /** `grab`: the file the link holds, or its name when it is over the size cap. */
  file: FilePayloadSchema.optional(),
  tooBig: z.object({ name: z.string().max(255) }).optional(),
});
/** How the self-check fared on one step (U7). */
export const ProbeReplySchema = z.object({
  status: z.enum(['found', 'ambiguous', 'missing']),
  strategy: z.string().optional(),
  confidence: z.number().optional(),
});
export type ProbeReply = z.infer<typeof ProbeReplySchema>;

/** The self-check's report (U7), one entry per step. */
export const SelfCheckReportSchema = z.array(
  z.object({
    stepId: z.string(),
    number: z.number().int(),
    status: z.enum(['found', 'ambiguous', 'missing', 'skipped']),
    strategy: z.string().optional(),
    confidence: z.number().optional(),
    reason: z.enum(['desktop', 'manual', 'no-target']).optional(),
  }),
);

export const CheckReplySchema = z.object({ failed: z.array(z.string()) });
/** The top page's host and whether a password or one-time-code field shows on it. */
export const SignInReplySchema = z.object({ host: z.string(), secretField: z.boolean() });

/** Broadcasts to extension pages. */
export const GuideBroadcastSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('guidance'), state: GuidanceStateSchema }),
  z.object({
    type: z.literal('picked'),
    tabId: z.number().int(),
    page: z.string(),
    frameUrl: z.string().optional(),
    target: TargetSchema.optional(),
    cancelled: z.boolean().optional(),
  }),
  z.object({ type: z.literal('marks-changed') }),
  z.object({ type: z.literal('desktop-state'), connected: z.boolean() }),
  /** Schedules or their run logs changed. */
  z.object({ type: z.literal('schedules-changed') }),
]);
export type GuideBroadcast = z.infer<typeof GuideBroadcastSchema>;
