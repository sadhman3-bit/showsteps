import { guideStats, type GuideStats, type GuideStore, type GuideSummary } from '@showsteps/core';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../Button.js';
import { Icon } from '../components/Icon.js';
import { strings } from '../strings.js';
import { relativeTime } from '../time.js';

const s = strings.insights;

interface Row {
  guide: GuideSummary;
  stats: GuideStats;
}

/** L5: views, Guide Me and Run for me runs, completions and drop-off, from per-user sidecars. */
export function Insights({
  store,
  onBack,
  onOpen,
  refreshKey,
}: {
  store: GuideStore;
  onBack: () => void;
  onOpen: (guideId: string) => void;
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<Row[] | undefined>();
  const [selected, setSelected] = useState<string>();

  useEffect(() => {
    let live = true;
    void (async () => {
      const guides = (await store.listGuides()).filter((g) => !g.trashedAt);
      const out: Row[] = [];
      for (const guide of guides) {
        const sidecars = await store.listSidecars(guide.id, 'analytics').catch(() => []);
        out.push({ guide, stats: guideStats(sidecars, guide.stepCount) });
      }
      out.sort(
        (a, b) =>
          b.stats.runs + b.stats.views - (a.stats.runs + a.stats.views) ||
          a.guide.title.localeCompare(b.guide.title),
      );
      if (live) setRows(out);
    })();
    return () => {
      live = false;
    };
  }, [store, refreshKey]);

  const detail = rows?.find((r) => r.guide.id === selected);
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <main class="ss-page ss-insights" aria-busy={!rows}>
      <nav class="ss-guide__nav">
        <Button variant="ghost" onClick={onBack}>
          <Icon name="back" /> {strings.guide.back}
        </Button>
      </nav>
      <h1>{s.title}</h1>
      <p class="ss-muted">{s.intro}</p>
      {rows && !rows.length ? <p class="ss-empty">{s.none}</p> : null}
      {rows?.length ? (
        <div class="ss-table-wrap">
          <table class="ss-table">
            <thead>
              <tr>
                <th scope="col">{s.guide}</th>
                <th scope="col">{s.views}</th>
                <th scope="col">{s.guideMe}</th>
                <th scope="col">{s.runForMe}</th>
                <th scope="col">{s.completed}</th>
                <th scope="col">{s.rate}</th>
                <th scope="col">{s.people}</th>
                <th scope="col">{s.lastUsed}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ guide, stats }) => (
                <tr key={guide.id} aria-selected={guide.id === selected}>
                  <th scope="row">
                    <button
                      type="button"
                      class="ss-link"
                      onClick={() => setSelected(guide.id === selected ? undefined : guide.id)}
                    >
                      {guide.title}
                    </button>
                  </th>
                  <td>{stats.views}</td>
                  <td>{stats.guideMeRuns}</td>
                  <td>{stats.runForMeRuns}</td>
                  <td>{stats.completions}</td>
                  <td>{stats.runs ? pct(stats.completionRate) : '–'}</td>
                  <td>{stats.people}</td>
                  <td>{stats.lastUsedAt ? relativeTime(stats.lastUsedAt) : s.never}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {detail ? (
        <section class="ss-dropoff" aria-labelledby="dropoff-h">
          <h2 id="dropoff-h">{s.dropOffFor(detail.guide.title)}</h2>
          {detail.stats.runs ? (
            <ol>
              {detail.stats.reachedSteps.map((n, i) => (
                <li key={i}>
                  <span class="ss-dropoff__label">{s.stepReached(i + 1, n)}</span>
                  <span
                    class="ss-dropoff__bar"
                    style={{ width: `${(n / detail.stats.runs) * 100}%` }}
                    aria-hidden="true"
                  />
                </li>
              ))}
            </ol>
          ) : (
            <p class="ss-muted">{s.noRuns}</p>
          )}
          <Button onClick={() => onOpen(detail.guide.id)}>{strings.marks.openGuide}</Button>
        </section>
      ) : null}
    </main>
  );
}
