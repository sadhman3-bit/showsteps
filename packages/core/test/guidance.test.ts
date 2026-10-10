import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import {
  createGuide,
  createStep,
  describeElement,
  failedExpectations,
  fromMarkdown,
  guideStats,
  marksForUrl,
  mergeThreads,
  pageKey,
  parseAnalytics,
  parseImproved,
  parseMarks,
  performStep,
  plain,
  planStep,
  recordRun,
  recordView,
  relevantGuides,
  runFields,
  samePage,
  toMarkdown,
  toggleReaction,
  translatableTexts,
  translatedCopy,
  valueFor,
  emptyComments,
  type GuideSummary,
  type PageMark,
  type Step,
} from '../src/index.js';

const web = { kind: 'web' as const, url: 'http://localhost:5173/app/' };

describe('pages and Discover', () => {
  it('compares pages by origin and path', () => {
    expect(pageKey('http://localhost:5173/app/?x=1#y')).toBe('http://localhost:5173/app');
    expect(pageKey('chrome://extensions')).toBe('');
    expect(samePage('http://a.test/x?1', 'http://a.test/x/#2')).toBe(true);
    expect(samePage('http://a.test/x', 'http://a.test/y')).toBe(false);
  });

  it('lists guides recorded on the current site, newest first', () => {
    const g = (
      id: string,
      origin: string,
      updatedAt: string,
      trashedAt?: string,
    ): GuideSummary => ({
      id,
      title: id,
      tags: [],
      createdAt: updatedAt,
      updatedAt,
      stepCount: 1,
      apps: [{ kind: 'web', origin }],
      searchText: '',
      ...(trashedAt ? { trashedAt } : {}),
    });
    const list = [
      g('old', 'http://localhost:5173', '2026-01-01'),
      g('new', 'http://localhost:5173', '2026-02-01'),
      g('other', 'https://example.com', '2026-03-01'),
      g('gone', 'http://localhost:5173', '2026-03-01', '2026-03-02'),
    ];
    expect(relevantGuides(list, 'http://localhost:5173/app/x').map((x) => x.id)).toEqual([
      'new',
      'old',
    ]);
    expect(relevantGuides(list, 'about:blank')).toEqual([]);
  });
});

describe('notes and pins', () => {
  const mark = (over: Partial<PageMark>): PageMark => ({
    id: 'm',
    kind: 'note',
    tone: 'tip',
    page: 'http://localhost:5173/app',
    text: plain('Hello'),
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...over,
  });

  it('belong to their page, or to their frame', () => {
    const marks = [
      mark({ id: 'page' }),
      mark({ id: 'frame', frameUrl: 'http://127.0.0.1:5174/widget.html' }),
      mark({ id: 'elsewhere', page: 'http://localhost:5173/reports.html' }),
    ];
    expect(marksForUrl(marks, 'http://localhost:5173/app/?q').map((m) => m.id)).toEqual(['page']);
    expect(marksForUrl(marks, 'http://127.0.0.1:5174/widget.html').map((m) => m.id)).toEqual([
      'frame',
    ]);
  });

  it('drop stored entries that no longer validate, and refuse unsafe links', () => {
    expect(parseMarks([mark({}), { id: 1 }, mark({ href: 'javascript:alert(1)' })])).toHaveLength(
      1,
    );
    expect(parseMarks('nope')).toEqual([]);
  });
});

function step(over: Partial<Step> & Pick<Step, 'action'>): Step {
  return { ...createStep({ app: web, ...over }), ...over } as Step;
}

describe('step plans and Run for me values', () => {
  const target = { selectors: [], bbox: { x: 0, y: 0, w: 1, h: 1 }, point: { x: 0, y: 0 } };

  it('decide what needs a person', () => {
    expect(planStep(step({ action: 'navigate' }))).toEqual({ kind: 'navigate', url: web.url });
    expect(planStep(step({ action: 'click', target }))).toEqual({ kind: 'act' });
    expect(planStep(step({ action: 'click' }))).toEqual({ kind: 'manual', reason: 'no-target' });
    expect(
      planStep(step({ action: 'type', target, input: { mode: 'fixed', sensitive: true } })),
    ).toEqual({ kind: 'manual', reason: 'secret' });
    expect(planStep(step({ action: 'upload', target }))).toEqual({
      kind: 'manual',
      reason: 'upload',
    });
    expect(planStep(step({ action: 'manual' }))).toEqual({ kind: 'manual', reason: 'manual' });
    expect(planStep(step({ action: 'key', key: 'Enter' }))).toEqual({ kind: 'act' });
  });

  it('ask for "ask" inputs and variables once, never for secrets', () => {
    const fixed = step({
      action: 'type',
      target,
      input: { mode: 'fixed', value: 'alex', sensitive: false },
    });
    const ask = step({
      action: 'type',
      target,
      input: { mode: 'ask', value: 'INV-1', sensitive: false },
    });
    const variable = step({
      action: 'type',
      target,
      input: { mode: 'default', variable: 'amount', value: '10', sensitive: false },
    });
    const again = step({
      action: 'type',
      target,
      input: { mode: 'default', variable: 'amount', sensitive: false },
    });
    const secret = step({ action: 'type', target, input: { mode: 'ask', sensitive: true } });
    const guide = createGuide({
      blocks: [fixed, ask, variable, again, secret],
      variables: [{ name: 'amount', label: 'Amount', defaultValue: '99', sensitive: false }],
    });
    const fields = runFields(guide);
    expect(fields.map((f) => [f.key, f.label, f.defaultValue])).toEqual([
      [ask.id, '', ''],
      ['amount', 'Amount', '99'],
    ]);
    expect(valueFor(fixed, {})).toBe('alex');
    expect(valueFor(ask, { [ask.id]: 'INV-7' })).toBe('INV-7');
    expect(valueFor(again, { amount: '42' })).toBe('42');
    expect(valueFor(secret, { [secret.id]: 'x' })).toBeUndefined();
  });
});

describe('comments and reactions (per-user sidecars)', () => {
  it('merge into threads per block and toggle reactions', () => {
    let mine = emptyComments('Alex');
    mine.comments.push({ id: 'c2', blockId: 's1', text: 'Second', at: '2026-01-02' });
    mine = toggleReaction(mine, 's1', '👍');
    mine = toggleReaction(toggleReaction(mine, 'end', '🎉'), 'end', '🎉');
    const theirs = {
      author: 'Priya',
      comments: [{ id: 'c1', blockId: 's1', text: 'First', at: '2026-01-01' }],
      reactions: [{ blockId: 's1', emoji: '👍' }],
    };
    const threads = mergeThreads(
      [
        { user: 'alex', data: mine },
        { user: 'priya', data: theirs },
        { user: 'broken', data: { comments: 'x' } },
      ],
      'Alex',
    );
    const t = threads.get('s1')!;
    expect(t.comments.map((c) => [c.text, c.author, c.mine])).toEqual([
      ['First', 'Priya', false],
      ['Second', 'Alex', true],
    ]);
    expect(t.reactions.get('👍')).toEqual(['Alex', 'Priya']);
    expect(threads.get('end')).toBeUndefined();
  });
});

describe('analytics (per-user sidecars)', () => {
  it('counts views, runs, completions and drop-off', () => {
    let a = parseAnalytics(undefined);
    a = recordView(recordView(a, '2026-01-01'), '2026-01-02');
    const run = {
      id: 'r1',
      mode: 'guide' as const,
      startedAt: '2026-01-03',
      reached: 1,
      total: 3,
      completed: false,
    };
    a = recordRun(a, run);
    a = recordRun(a, { ...run, reached: 1 }); // same run, updated: it got to step 2
    const b = recordRun(parseAnalytics({}), {
      id: 'r2',
      mode: 'run',
      startedAt: '2026-01-04',
      endedAt: '2026-01-04T01',
      reached: 3,
      total: 3,
      completed: true,
    });
    const stats = guideStats(
      [
        { user: 'a', data: a },
        { user: 'b', data: b },
      ],
      3,
    );
    expect(stats).toMatchObject({
      views: 2,
      runs: 2,
      guideMeRuns: 1,
      runForMeRuns: 1,
      completions: 1,
      completionRate: 0.5,
      reachedSteps: [2, 2, 1],
      people: 2,
      lastUsedAt: '2026-01-04T01',
    });
  });
});

describe('Run for me actions (DOM)', () => {
  function page(html: string) {
    const w = new Window({ url: 'http://localhost:5173/app/' });
    w.document.body.innerHTML = html;
    return w.document as unknown as Document;
  }

  it('clicks, types, selects, checks and presses keys with events apps notice', () => {
    const doc = page(`
      <form><label>Supplier <input id="s"></label>
      <label>Currency <select id="c"><option value="aud">AUD</option><option value="nzd">NZD</option></select></label>
      <label><input type="checkbox" id="g"> Includes GST</label>
      <button type="button" id="b">Save</button></form>`);
    const log: string[] = [];
    const s = doc.getElementById('s')!;
    s.addEventListener('input', () => log.push(`input:${(s as HTMLInputElement).value}`));
    s.addEventListener('change', () => log.push('change'));
    doc.getElementById('b')!.addEventListener('click', () => log.push('click'));
    doc.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      log.push('submit');
    });

    expect(performStep(s, step({ action: 'type' }), 'Harbour Paper Co.')).toBe(true);
    expect(performStep(doc.getElementById('c')!, step({ action: 'select' }), 'NZD')).toBe(true);
    expect((doc.getElementById('c') as HTMLSelectElement).value).toBe('nzd');
    const box = doc.getElementById('g') as HTMLInputElement;
    performStep(box, step({ action: 'check' }), 'true');
    performStep(box, step({ action: 'check' }), 'true'); // already checked: no toggle
    expect(box.checked).toBe(true);
    performStep(box, step({ action: 'check' }), 'false');
    expect(box.checked).toBe(false);
    performStep(doc.getElementById('b')!, step({ action: 'click' }), undefined);
    performStep(s, step({ action: 'key', key: 'Enter' }), undefined);
    expect(log).toEqual(['input:Harbour Paper Co.', 'change', 'click', 'submit']);
    expect(performStep(s, step({ action: 'type' }), undefined)).toBe(false);
  });

  it('reports expectations that do not hold', () => {
    const doc = page('<h1>Invoice submitted</h1><button>Done</button>');
    const button = describeElement(doc.querySelector('button')!);
    const failed = failedExpectations(doc, 'http://localhost:5173/app/invoices/done', [
      { type: 'url', matches: '/invoices/done' },
      { type: 'text', contains: 'Invoice  submitted' },
      { type: 'visible', target: button },
      { type: 'hidden', target: button },
      { type: 'text', contains: 'Error' },
    ]);
    expect(failed.map((f) => f.type)).toEqual(['hidden', 'text']);
  });
});

describe('on-device AI helpers', () => {
  it('reads back the Markdown that rich text writes', () => {
    const rt = {
      spans: [
        { text: 'Click ' },
        { text: 'Save *now*', bold: true },
        { text: ' or see ' },
        { text: 'help', href: 'https://example.com/h' },
      ],
    };
    expect(fromMarkdown(toMarkdown(rt))).toEqual(rt);
  });

  it('cleans model replies into step titles', () => {
    expect(parseImproved('Step 3: "Click **Save**."\nExtra')).toEqual({
      spans: [{ text: 'Click ' }, { text: 'Save', bold: true }, { text: '.' }],
    });
    expect(parseImproved('   ')).toBeUndefined();
  });

  it('makes a translated copy with a new id and the language tag', () => {
    const s1 = step({
      action: 'click',
      human: { title: plain('Click Save'), annotations: [], blurs: [], altText: 'Alt' },
    });
    const guide = createGuide({
      title: 'Pay',
      description: 'Pay a bill',
      blocks: [{ id: 'h', kind: 'heading', text: 'Start' }, s1],
    });
    const texts = translatableTexts(guide);
    expect([...texts.keys()]).toEqual([
      'title',
      'description',
      'block:h',
      `title:${s1.id}`,
      `alt:${s1.id}`,
    ]);
    const copy = translatedCopy(
      guide,
      new Map([
        ['title', 'Payer'],
        ['block:h', 'Début'],
        [`title:${s1.id}`, 'Cliquez sur **Enregistrer**'],
      ]),
      'fr',
    );
    expect(copy.id).not.toBe(guide.id);
    expect(copy.title).toBe('Payer');
    expect(copy.description).toBe('Pay a bill');
    expect(copy.tags).toContain('fr');
    expect(copy.blocks[0]).toMatchObject({ text: 'Début' });
    expect((copy.blocks[1] as Step).human.title.spans[1]).toEqual({
      text: 'Enregistrer',
      bold: true,
    });
    expect((copy.blocks[1] as Step).human.altText).toBe('Alt');
    expect(guide.title).toBe('Pay');
  });
});
