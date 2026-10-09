// Every message between extension contexts, validated with Zod on receipt.
import { z } from 'zod';
import { RectSchema, TargetSchema } from '@trailmark/core';

const ElementKey = z.string().min(1).max(100);
const ShotId = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

/** Events a content script reports. The background adds the app context and timestamp. */
export const ContentEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('click'),
    button: z.enum(['left', 'right']),
    target: TargetSchema,
    element: ElementKey,
    toggle: z.object({ role: z.enum(['checkbox', 'radio']), checked: z.boolean() }).optional(),
  }),
  z.object({ kind: z.literal('dblclick'), target: TargetSchema, element: ElementKey }),
  z.object({
    kind: z.literal('type'),
    target: TargetSchema,
    element: ElementKey,
    value: z.string().max(10_000).optional(),
    sensitive: z.boolean(),
  }),
  z.object({
    kind: z.literal('select'),
    target: TargetSchema,
    element: ElementKey,
    value: z.string().max(1000),
  }),
  z.object({
    kind: z.literal('check'),
    target: TargetSchema,
    element: ElementKey,
    checked: z.boolean(),
    role: z.enum(['checkbox', 'radio']),
  }),
  z.object({
    kind: z.literal('upload'),
    target: TargetSchema,
    element: ElementKey,
    files: z.array(z.string().max(260)).max(50),
  }),
  z.object({
    kind: z.literal('key'),
    key: z.string().min(1).max(40),
    target: TargetSchema.optional(),
    element: ElementKey.optional(),
  }),
]);
export type ContentEvent = z.infer<typeof ContentEventSchema>;

export const ControlActionSchema = z.enum([
  'pause',
  'resume',
  'delete-last',
  'toggle-live-blur',
  'finish',
  'cancel',
]);
export type ControlAction = z.infer<typeof ControlActionSchema>;

const Viewport = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  dpr: z.number().positive(),
});

/** Messages from content scripts (sender has a tab). */
export const ContentMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello') }),
  z.object({ type: z.literal('frame-register'), token: z.string().uuid() }),
  z.object({ type: z.literal('viewport'), viewport: Viewport }),
  z.object({ type: z.literal('shot'), shotId: ShotId, uiHidden: z.boolean().optional() }),
  z.object({ type: z.literal('event'), shotId: ShotId.optional(), event: ContentEventSchema }),
  z.object({ type: z.literal('control'), action: ControlActionSchema }),
]);
export type ContentMessage = z.infer<typeof ContentMessageSchema>;

/** Messages from extension pages (side panel, library). */
export const PageMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    tabId: z.number().int(),
    guideId: z.string().optional(),
    insertAt: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal('get-state') }),
  z.object({ type: z.literal('control'), action: ControlActionSchema }),
]);
export type PageMessage = z.infer<typeof PageMessageSchema>;

export const CaptureStateSchema = z.object({
  status: z.enum(['idle', 'recording', 'paused']),
  guideId: z.string().optional(),
  title: z.string().optional(),
  stepCount: z.number().int().nonnegative(),
  liveBlur: z.boolean(),
  /** Set after Finish so the UI can offer to open the guide. */
  lastFinishedGuideId: z.string().optional(),
  error: z.string().optional(),
});
export type CaptureState = z.infer<typeof CaptureStateSchema>;

export const IDLE_STATE: CaptureState = { status: 'idle', stepCount: 0, liveBlur: false };

/** Messages from the background to content scripts. */
export const BackgroundToContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), state: CaptureStateSchema }),
  z.object({ type: z.literal('iframe-geometry'), token: z.string().uuid() }),
  /** Hide Trailmark's on-page UI for a screenshot; the reply comes after it is painted. */
  z.object({ type: z.literal('overlays'), visible: z.boolean() }),
  /** The user left this tab: record any typing not yet committed. */
  z.object({ type: z.literal('flush') }),
]);
export type BackgroundToContent = z.infer<typeof BackgroundToContentSchema>;

export const IframeGeometrySchema = z.object({ rect: RectSchema, selector: z.string() }).nullable();
export type IframeGeometry = z.infer<typeof IframeGeometrySchema>;

/** Broadcasts from the background to extension pages. */
export const BroadcastSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), state: CaptureStateSchema }),
  z.object({ type: z.literal('library-changed') }),
]);
export type Broadcast = z.infer<typeof BroadcastSchema>;

/** Pending "capture more" request handed from the library to the side panel. */
export const CaptureMoreSchema = z.object({
  guideId: z.string(),
  title: z.string(),
  insertAt: z.number().int().nonnegative(),
  /** Number of steps before the insert position, for display. */
  afterStep: z.number().int().nonnegative(),
});
export type CaptureMore = z.infer<typeof CaptureMoreSchema>;
export const CAPTURE_MORE_KEY = 'captureMore';
