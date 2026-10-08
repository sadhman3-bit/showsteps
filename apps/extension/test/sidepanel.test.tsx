import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { SidePanel } from '../entrypoints/sidepanel/SidePanel';

describe('SidePanel', () => {
  it('states that data stays local', () => {
    const html = renderToString(<SidePanel />);
    expect(html).toContain('Trailmark');
    expect(html).toContain('Nothing is uploaded');
  });
});
