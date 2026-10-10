/**
 * Chrome's built-in, on-device AI (Prompt API, Summarizer, Translator). Everything runs on this
 * computer; nothing is sent anywhere. Each API is feature-detected, and the UI hides tools
 * that are unavailable. Off by default (Settings).
 */

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface PromptSession {
  prompt(input: string): Promise<string>;
  destroy(): void;
}
interface LanguageModelApi {
  availability(): Promise<Availability>;
  create(opts: {
    initialPrompts?: { role: 'system'; content: string }[];
    expectedOutputs?: { type: 'text'; languages: string[] }[];
  }): Promise<PromptSession>;
}
interface SummarizerSession {
  summarize(input: string, opts?: { context?: string }): Promise<string>;
  destroy(): void;
}
interface SummarizerApi {
  availability(): Promise<Availability>;
  create(opts: {
    type: 'tldr' | 'key-points' | 'teaser' | 'headline';
    format: 'plain-text' | 'markdown';
    length: 'short' | 'medium' | 'long';
    sharedContext?: string;
  }): Promise<SummarizerSession>;
}
interface TranslatorSession {
  translate(input: string): Promise<string>;
  destroy(): void;
}
interface TranslatorApi {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  create(opts: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorSession>;
}

const api = globalThis as unknown as {
  LanguageModel?: LanguageModelApi;
  Summarizer?: SummarizerApi;
  Translator?: TranslatorApi;
};

export interface AiCapabilities {
  improve: boolean;
  summarize: boolean;
  translate: boolean;
}

const usable = (a: Availability | undefined) => !!a && a !== 'unavailable';

/** Which on-device tools this browser offers (a model may still need to download). */
export async function detectAi(): Promise<AiCapabilities> {
  const check = async (f: (() => Promise<Availability>) | undefined) => {
    try {
      return usable(await f?.());
    } catch {
      return false;
    }
  };
  const { LanguageModel, Summarizer, Translator } = api;
  return {
    improve: await check(LanguageModel && (() => LanguageModel.availability())),
    summarize: await check(Summarizer && (() => Summarizer.availability())),
    translate: await check(
      Translator && (() => Translator.availability({ sourceLanguage: 'en', targetLanguage: 'fr' })),
    ),
  };
}

export const anyAi = (c: AiCapabilities) => c.improve || c.summarize || c.translate;

/** Ask the on-device model once per input, reusing one session. */
export async function promptEach(system: string, inputs: string[]): Promise<string[]> {
  if (!api.LanguageModel) throw new Error('unavailable');
  const session = await api.LanguageModel.create({
    initialPrompts: [{ role: 'system', content: system }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  });
  try {
    const out: string[] = [];
    for (const input of inputs) out.push(await session.prompt(input));
    return out;
  } finally {
    session.destroy();
  }
}

export async function summarize(text: string, context: string): Promise<string> {
  if (!api.Summarizer) throw new Error('unavailable');
  const s = await api.Summarizer.create({
    type: 'tldr',
    format: 'plain-text',
    length: 'short',
    sharedContext: context,
  });
  try {
    return (await s.summarize(text)).trim();
  } finally {
    s.destroy();
  }
}

export async function translateAll(texts: string[], target: string): Promise<string[]> {
  if (!api.Translator) throw new Error('unavailable');
  const opts = { sourceLanguage: 'en', targetLanguage: target };
  if (!usable(await api.Translator.availability(opts))) throw new Error('unavailable');
  const t = await api.Translator.create(opts);
  try {
    const out: string[] = [];
    for (const text of texts) out.push(await t.translate(text));
    return out;
  } finally {
    t.destroy();
  }
}
