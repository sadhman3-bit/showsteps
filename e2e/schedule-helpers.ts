import type { Worker } from '@playwright/test';

export type Target = {
  role?: string;
  name?: string;
  selectors: { type: string; value: string; score: number }[];
};
export type Step = {
  id: string;
  kind: 'step';
  action: string;
  app: { kind: string; url: string; title?: string; frameUrl?: string };
  target?: Target;
  input?: { mode: string; value?: string; sensitive: boolean };
  human: { title: { spans: { text: string }[] } };
  agent: { confirm: boolean; expect?: unknown[] };
};
export type Guide = { id: string; title: string; blocks: Step[] };
export type RunLog = {
  id: string;
  outcome?: string;
  reason?: string;
  values: Record<string, string>;
  steps: { number: number; status: string; screenshot?: string }[];
};
export type State = {
  status: string;
  phase: string;
  reason?: string;
  index: number;
  tabId?: number;
};
export type Hook = {
  installSamples(): Promise<string[]>;
  store: {
    listGuides(): Promise<{ id: string; title: string }[]>;
    getGuide(id: string): Promise<Guide>;
    saveGuide(g: Guide): Promise<void>;
  };
  guidance: { current: State; control(a: string): Promise<State> };
  scheduler: {
    save(s: object): Promise<{ id: string }>;
    onAlarm(name: string): Promise<void>;
  };
  runLogs: {
    list(scheduleId: string): Promise<RunLog[]>;
    getShot(name: string): Promise<Blob | undefined>;
  };
  guideVersion(g: Guide): string;
};
declare const __showsteps: Hook;

export const INVOICE = 'Create a supplier invoice in Ledgerline';
export const IDP = 'http://127.0.0.1:5174/idp/';
export const titleOf = (s: Step) => s.human.title.spans.map((x) => x.text).join('');

/**
 * The sample invoice guide with the username/password sign-in swapped for single sign-on through
 * the demo identity provider, so it can run unattended. The supplier is asked every run.
 * With `fromApp`, the guide starts on the app itself (a session that may have expired).
 */
export async function scheduledGuide(
  sw: Worker,
  fromApp = false,
): Promise<{ id: string; steps: Step[] }> {
  return sw.evaluate(
    async ({ title, idp, fromApp }) => {
      await __showsteps.installSamples();
      const sampleId = (await __showsteps.store.listGuides()).find((g) => g.title === title)!.id;
      const sample = await __showsteps.store.getGuide(sampleId);
      const steps = sample.blocks.filter((b) => b.kind === 'step');
      const text = (s: Step) => s.human.title.spans.map((x) => x.text).join('');
      const open = structuredClone(steps[0]!);
      const signIn = steps.find((s) => text(s) === 'Click Sign in')!;
      const click = (id: string, label: string, target: Target, url: string): Step => ({
        ...structuredClone(signIn),
        id,
        app: { kind: 'web', url },
        // Only the box and point from the recorded step; the rest describes the new element.
        target: {
          bbox: structuredClone((signIn.target as unknown as { bbox: object }).bbox),
          point: structuredClone((signIn.target as unknown as { point: object }).point),
          ...target,
        } as Target,
        human: { ...structuredClone(signIn.human), title: { spans: [{ text: label }] } },
        agent: { ...structuredClone(signIn.agent), expect: [] },
      });
      const sso = click(
        'sso-link',
        'Click Use single sign-on',
        {
          role: 'link',
          name: 'Use single sign-on',
          selectors: [{ type: 'aria', value: 'link "Use single sign-on"', score: 0.9 }],
        },
        'http://localhost:5173/login.html',
      );
      const tile = click(
        'sso-tile',
        'Click Alex Demo',
        {
          role: 'button',
          name: 'Alex Demo alex@ledgerline.example',
          selectors: [
            { type: 'aria', value: 'button "Alex Demo alex@ledgerline.example"', score: 0.9 },
          ],
        },
        idp,
      );
      const work = steps.slice(steps.findIndex((s) => text(s) === 'Click New invoice'));
      const supplier = work.find((s) => s.target?.name === 'Supplier')!;
      supplier.input = { mode: 'ask', sensitive: false };
      const start = fromApp
        ? { ...open, id: 'open-app', app: { kind: 'web', url: 'http://localhost:5173/app/' } }
        : open;
      const guide: Guide = {
        ...structuredClone(sample),
        id: fromApp ? 'scheduled-app' : 'scheduled',
        title: fromApp ? 'Scheduled invoice (signed in)' : 'Scheduled invoice',
        blocks: fromApp ? [start, ...work] : [start, sso, tile, ...work],
      };
      await __showsteps.store.saveGuide(guide);
      return { id: guide.id, steps: guide.blocks };
    },
    { title: INVOICE, idp: IDP, fromApp },
  );
}

export async function saveSchedule(
  sw: Worker,
  guideId: string,
  steps: Step[],
  over: { approve?: boolean; keepWindowOpen?: boolean } = {},
): Promise<string> {
  const supplier = steps.find((s) => s.target?.name === 'Supplier')!.id;
  const submit = steps.find((s) => titleOf(s) === 'Click Submit invoice')!.id;
  return sw.evaluate(
    async ({ guideId, supplier, submit, over }) => {
      const guide = await __showsteps.store.getGuide(guideId);
      const id = `sched-${Math.random().toString(36).slice(2)}`;
      await __showsteps.scheduler.save({
        id,
        guideId,
        name: guide.title,
        enabled: true,
        createdAt: new Date().toISOString(),
        guideVersion: 'stamped-on-save',
        recurrence: { kind: 'daily' },
        time: '09:00',
        skipDates: [],
        missedRun: 'run-at-start',
        values: { [supplier]: 'Saltbush {today}' },
        dateFormat: 'dd/MM/yyyy',
        approvedConfirmSteps: over.approve
          ? { guideVersion: __showsteps.guideVersion(guide), stepIds: [submit] }
          : { guideVersion: '', stepIds: [] },
        waitMinutes: 30,
        keepWindowOpen: over.keepWindowOpen ?? false,
        checkFirst: false,
      });
      return id;
    },
    { guideId, supplier, submit, over },
  );
}
