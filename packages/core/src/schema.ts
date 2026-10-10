import { z } from 'zod';
import { SCHEMA_VERSION } from './version.js';

// ---------- Primitives ----------

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
});
export type Rect = z.infer<typeof RectSchema>;

export const PointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof PointSchema>;

/** One run of rich text. Links are limited to http(s) and mailto, checked on parse. */
export const SpanSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  href: z
    .string()
    .regex(/^(https?:|mailto:)/i, 'Links must start with http:, https: or mailto:')
    .optional(),
});
export type Span = z.infer<typeof SpanSchema>;

/** Small rich-text document: an ordered list of spans (bold, italic, link). */
export const RichTextSchema = z.object({ spans: z.array(SpanSchema) });
export type RichText = z.infer<typeof RichTextSchema>;

export const InputModeSchema = z.enum(['fixed', 'ask', 'default']);
export type InputMode = z.infer<typeof InputModeSchema>;

// ---------- Targets ----------

export const SelectorTypeSchema = z.enum([
  'testid',
  'aria',
  'label',
  'text',
  'css',
  'xpath',
  'uia',
]);
export type SelectorType = z.infer<typeof SelectorTypeSchema>;

export const SelectorSchema = z.object({
  type: SelectorTypeSchema,
  value: z.string().min(1),
  score: z.number().min(0).max(1),
});
export type Selector = z.infer<typeof SelectorSchema>;

export const UiaInfoSchema = z.object({
  automationId: z.string().optional(),
  name: z.string().optional(),
  controlType: z.string().optional(),
  className: z.string().optional(),
  windowTitle: z.string().optional(),
  processName: z.string().optional(),
  path: z.array(z.string()).optional(),
});
export type UiaInfo = z.infer<typeof UiaInfoSchema>;

export const TargetSchema = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  testId: z.string().optional(),
  tag: z.string().optional(),
  selectors: z.array(SelectorSchema),
  frames: z.array(z.string()).optional(),
  shadowHosts: z.array(z.string()).optional(),
  uia: UiaInfoSchema.optional(),
  bbox: RectSchema,
  point: PointSchema,
  ocrText: z.string().optional(),
});
export type Target = z.infer<typeof TargetSchema>;

export const PartialTargetSchema = TargetSchema.partial();

export const ExpectationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url'), matches: z.string() }),
  z.object({ type: z.literal('visible'), target: PartialTargetSchema }),
  z.object({ type: z.literal('hidden'), target: PartialTargetSchema }),
  z.object({ type: z.literal('text'), contains: z.string() }),
  z.object({ type: z.literal('window'), titleContains: z.string() }),
]);
export type Expectation = z.infer<typeof ExpectationSchema>;

// ---------- Human layer ----------

export const AnnotationSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    kind: z.literal('arrow'),
    from: PointSchema,
    to: PointSchema,
    color: z.string(),
  }),
  z.object({ id: z.string(), kind: z.literal('rect'), rect: RectSchema, color: z.string() }),
  z.object({ id: z.string(), kind: z.literal('ellipse'), rect: RectSchema, color: z.string() }),
  z.object({
    id: z.string(),
    kind: z.literal('text'),
    at: PointSchema,
    text: z.string(),
    color: z.string(),
    size: z.number().positive().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('pen'),
    points: z.array(PointSchema).min(2),
    color: z.string(),
    width: z.number().positive().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('badge'),
    at: PointSchema,
    number: z.number().int().positive(),
    color: z.string(),
  }),
]);
export type Annotation = z.infer<typeof AnnotationSchema>;

export const ScreenshotSchema = z.object({
  file: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  dpr: z.number().positive(),
  crop: RectSchema.optional(),
  zoom: z.number().positive().optional(),
  reusedFromStepId: z.string().optional(),
});
export type Screenshot = z.infer<typeof ScreenshotSchema>;

// ---------- Blocks ----------

export const StepActionSchema = z.enum([
  'click',
  'double_click',
  'right_click',
  'type',
  'select',
  'check',
  'key',
  'navigate',
  'scroll',
  'hover',
  'wait',
  'upload',
  'manual',
]);
export type StepAction = z.infer<typeof StepActionSchema>;

export const AppContextSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('web'),
    url: z.string(),
    title: z.string().optional(),
    frameUrl: z.string().optional(),
  }),
  z.object({ kind: z.literal('desktop'), processName: z.string(), windowTitle: z.string() }),
]);
export type AppContext = z.infer<typeof AppContextSchema>;

export const StepInputSchema = z.object({
  mode: InputModeSchema,
  value: z.string().optional(),
  variable: z.string().optional(),
  sensitive: z.boolean(),
});
export type StepInput = z.infer<typeof StepInputSchema>;

export const StepSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal('step'),
    action: StepActionSchema,
    app: AppContextSchema,
    target: TargetSchema.optional(),
    input: StepInputSchema.optional(),
    key: z.string().optional(),
    human: z.object({
      title: RichTextSchema,
      description: RichTextSchema.optional(),
      altText: z.string().optional(),
      screenshot: ScreenshotSchema.optional(),
      actionBox: RectSchema.optional(),
      annotations: z.array(AnnotationSchema),
      blurs: z.array(RectSchema),
      /** The screenshot and Action Box as captured, kept when the image is first edited. */
      original: z
        .object({ screenshot: ScreenshotSchema, actionBox: RectSchema.optional() })
        .optional(),
    }),
    agent: z.object({
      intent: z.string().optional(),
      expect: z.array(ExpectationSchema).optional(),
      onFailure: z.string().optional(),
      timeoutMs: z.number().int().positive(),
      confirm: z.boolean(),
      visualOnly: z.boolean(),
    }),
    capture: z.object({
      at: z.string(),
      tabId: z.number().int().optional(),
      source: z.enum(['extension', 'desktop', 'upload', 'manual']),
    }),
  })
  .refine((s) => !(s.input?.sensitive && s.input.value), {
    message: 'Sensitive inputs must never store a value',
    path: ['input', 'value'],
  });
export type Step = z.infer<typeof StepSchema>;

export const HeadingSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('heading'),
  text: z.string(),
});
export type Heading = z.infer<typeof HeadingSchema>;

export const CalloutToneSchema = z.enum(['tip', 'note', 'warning', 'alert']);
export type CalloutTone = z.infer<typeof CalloutToneSchema>;

export const CalloutSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('callout'),
  tone: CalloutToneSchema,
  text: z.string(),
});
export type Callout = z.infer<typeof CalloutSchema>;

export const BlockSchema = z.union([StepSchema, HeadingSchema, CalloutSchema]);
export type Block = Step | Heading | Callout;

// ---------- Guide ----------

export const VariableSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, digits and underscores'),
    label: z.string(),
    description: z.string().optional(),
    example: z.string().optional(),
    defaultValue: z.string().optional(),
    sensitive: z.boolean(),
  })
  .refine((v) => !(v.sensitive && (v.defaultValue || v.example)), {
    message: 'Sensitive variables must not store a default or example value',
    path: ['defaultValue'],
  });
export type Variable = z.infer<typeof VariableSchema>;

export const AppRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('web'), origin: z.string() }),
  z.object({ kind: z.literal('desktop'), processName: z.string() }),
]);
export type AppRef = z.infer<typeof AppRefSchema>;

export const GuideSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal(SCHEMA_VERSION),
    title: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()),
    folderId: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    author: z.string().optional(),
    /** Who saved this version last (shown in shared libraries). */
    updatedBy: z.string().optional(),
    preconditions: z.array(z.string()),
    success: z.string().optional(),
    apps: z.array(AppRefSchema),
    variables: z.array(VariableSchema),
    blocks: z.array(BlockSchema),
    branding: z
      .object({
        logo: z.string().optional(),
        accent: z.string().optional(),
        font: z.string().optional(),
      })
      .optional(),
    settings: z.object({ defaultInputMode: InputModeSchema }),
  })
  .superRefine((g, ctx) => {
    const seen = new Set<string>();
    g.blocks.forEach((b, i) => {
      if (seen.has(b.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate block id "${b.id}"`,
          path: ['blocks', i, 'id'],
        });
      }
      seen.add(b.id);
    });
    const names = new Set(g.variables.map((v) => v.name));
    g.blocks.forEach((b, i) => {
      if (b.kind === 'step' && b.input?.variable && !names.has(b.input.variable)) {
        ctx.addIssue({
          code: 'custom',
          message: `Step uses unknown variable "${b.input.variable}"`,
          path: ['blocks', i, 'input', 'variable'],
        });
      }
    });
  });
export type Guide = z.infer<typeof GuideSchema>;

export const isStep = (b: Block): b is Step => b.kind === 'step';
