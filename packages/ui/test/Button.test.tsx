import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { Button } from '../src/index.js';

describe('Button', () => {
  it('defaults to a non-submitting button', () => {
    const html = renderToString(<Button>Save</Button>);
    expect(html).toContain('type="button"');
    expect(html).toContain('data-variant="default"');
    expect(html).toContain('>Save<');
  });

  it('renders the primary variant', () => {
    const html = renderToString(<Button variant="primary">Start capture</Button>);
    expect(html).toContain('data-variant="primary"');
  });
});
