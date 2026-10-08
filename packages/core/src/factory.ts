import { createId, nowIso } from './ids.js';
import { plain } from './richText.js';
import type {
  AppContext,
  Callout,
  CalloutTone,
  Guide,
  Heading,
  Step,
  StepAction,
} from './schema.js';
import { SCHEMA_VERSION } from './version.js';

export const DEFAULT_TIMEOUT_MS = 10_000;

export function createGuide(init: Partial<Omit<Guide, 'schemaVersion'>> = {}): Guide {
  const at = nowIso();
  return {
    id: createId(),
    title: 'Untitled guide',
    tags: [],
    createdAt: at,
    updatedAt: at,
    preconditions: [],
    apps: [],
    variables: [],
    blocks: [],
    settings: { defaultInputMode: 'fixed' },
    ...init,
    schemaVersion: SCHEMA_VERSION,
  };
}

export type StepInit = Partial<Omit<Step, 'kind' | 'human' | 'agent' | 'capture'>> & {
  action: StepAction;
  app: AppContext;
  human?: Partial<Step['human']>;
  agent?: Partial<Step['agent']>;
  capture?: Partial<Step['capture']>;
};

export function createStep(init: StepInit): Step {
  const { human, agent, capture, ...rest } = init;
  return {
    id: createId(),
    ...rest,
    kind: 'step',
    human: { title: plain(''), annotations: [], blurs: [], ...human },
    agent: { timeoutMs: DEFAULT_TIMEOUT_MS, confirm: false, visualOnly: false, ...agent },
    capture: { at: nowIso(), source: 'manual', ...capture },
  };
}

export function createHeading(text: string): Heading {
  return { id: createId(), kind: 'heading', text };
}

export function createCallout(tone: CalloutTone, text: string): Callout {
  return { id: createId(), kind: 'callout', tone, text };
}
