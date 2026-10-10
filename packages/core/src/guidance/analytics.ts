import { z } from 'zod';

/** Runs kept per person and guide (oldest dropped first). */
export const MAX_RUNS = 500;

const RunSchema = z.object({
  id: z.string().min(1).max(64),
  mode: z.enum(['guide', 'run']),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  /** Index of the furthest step reached (0 = on step 1; equals total when finished). */
  reached: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  completed: z.boolean(),
});
export type Run = z.infer<typeof RunSchema>;

/** One person's usage of one guide (their own sidecar file). Nothing leaves the machine. */
export const AnalyticsSidecarSchema = z.object({
  views: z.number().int().nonnegative(),
  lastViewedAt: z.string().optional(),
  runs: z.array(RunSchema),
});
export type AnalyticsSidecar = z.infer<typeof AnalyticsSidecarSchema>;

export function parseAnalytics(raw: unknown): AnalyticsSidecar {
  const r = AnalyticsSidecarSchema.safeParse(raw);
  return r.success ? r.data : { views: 0, runs: [] };
}

export function recordView(a: AnalyticsSidecar, at: string): AnalyticsSidecar {
  return { ...a, views: a.views + 1, lastViewedAt: at };
}

/** Add or update a run (matched by id), keeping the newest MAX_RUNS. */
export function recordRun(a: AnalyticsSidecar, run: Run): AnalyticsSidecar {
  const runs = a.runs.filter((r) => r.id !== run.id);
  runs.push(run);
  return { ...a, runs: runs.slice(-MAX_RUNS) };
}

export interface GuideStats {
  views: number;
  runs: number;
  guideMeRuns: number;
  runForMeRuns: number;
  completions: number;
  /** 0..1, or 0 with no runs. */
  completionRate: number;
  /** reachedSteps[i] = runs that reached step i + 1 (a funnel: step 1 counts every run). */
  reachedSteps: number[];
  people: number;
  lastUsedAt?: string;
}

/** Combine everyone's sidecars for one guide. `stepCount` sizes the drop-off chart. */
export function guideStats(
  sidecars: { user: string; data: unknown }[],
  stepCount: number,
): GuideStats {
  let views = 0;
  const runs: Run[] = [];
  let last: string | undefined;
  for (const { data } of sidecars) {
    const a = parseAnalytics(data);
    views += a.views;
    runs.push(...a.runs);
    for (const t of [a.lastViewedAt, ...a.runs.map((r) => r.endedAt ?? r.startedAt)]) {
      if (t && (!last || t > last)) last = t;
    }
  }
  const completions = runs.filter((r) => r.completed).length;
  const reachedSteps = Array.from(
    { length: stepCount },
    (_, i) => runs.filter((r) => r.completed || r.reached >= i).length,
  );
  return {
    views,
    runs: runs.length,
    guideMeRuns: runs.filter((r) => r.mode === 'guide').length,
    runForMeRuns: runs.filter((r) => r.mode === 'run').length,
    completions,
    completionRate: runs.length ? completions / runs.length : 0,
    reachedSteps,
    people: sidecars.filter(({ data }) => {
      const a = parseAnalytics(data);
      return a.views > 0 || a.runs.length > 0;
    }).length,
    ...(last ? { lastUsedAt: last } : {}),
  };
}
