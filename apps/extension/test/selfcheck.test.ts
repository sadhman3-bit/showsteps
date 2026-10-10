import { createGuide, createStep, plain, type Step, type Target } from '@trailmark/core';
import { describe, expect, it } from 'vitest';
import type { GuideToContent } from '../lib/guideMessages';
import { selfCheck, type SelfCheckDeps } from '../lib/selfcheck';

const target = (name: string): Target => ({
  role: 'button',
  name,
  selectors: [{ type: 'aria', value: `button "${name}"`, score: 0.9 }],
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  point: { x: 5, y: 5 },
});
const web = (url: string) => ({ kind: 'web' as const, url });

describe('self-check (U7)', () => {
  it('opens each step’s page, looks for its element without acting, and reports', async () => {
    const steps: Step[] = [
      createStep({ action: 'navigate', app: web('http://app.test/login') }),
      createStep({ action: 'click', app: web('http://app.test/login'), target: target('Sign in') }),
      createStep({
        action: 'click',
        app: web('http://app.test/app/'),
        target: target('New invoice'),
      }),
      createStep({ action: 'click', app: web('http://app.test/app/'), target: target('Gone') }),
      createStep({
        action: 'click',
        app: { kind: 'desktop', processName: 'excel', windowTitle: 'Book1' },
        human: { title: plain('Click Bold') },
      }),
    ];
    const guide = { ...createGuide({ title: 'T' }), blocks: steps };
    let url = '';
    const visited: string[] = [];
    const sent: GuideToContent[] = [];
    const deps: SelfCheckDeps = {
      openTab: async (u) => {
        url = u;
        visited.push(u);
        return 1;
      },
      navigate: async (_t, u) => {
        url = u;
        visited.push(u);
      },
      waitLoaded: async () => undefined,
      tabUrl: async () => url,
      frames: async () => [{ frameId: 0, url }],
      sleep: async () => undefined,
      send: async (_tab, msg) => {
        sent.push(msg);
        if (msg.type !== 'guide-probe') return { ok: true };
        const name = msg.step.target?.name;
        if (name === 'Gone') return { status: 'missing' };
        if (name === 'New invoice')
          return { status: 'ambiguous', strategy: 'aria', confidence: 0.5 };
        return { status: 'found', strategy: 'aria', confidence: 1 };
      },
    };
    const report = await selfCheck(guide, deps);
    expect(report.map((r) => [r.number, r.status, r.reason ?? r.strategy])).toEqual([
      [1, 'found', 'address'],
      [2, 'found', 'aria'],
      [3, 'ambiguous', 'aria'],
      [4, 'missing', undefined],
      [5, 'skipped', 'desktop'],
    ]);
    // Straight to each page; nothing is ever performed.
    expect(visited).toEqual(['http://app.test/login', 'http://app.test/app/']);
    expect(sent.some((m) => m.type === 'guide-run')).toBe(false);
  });
});
