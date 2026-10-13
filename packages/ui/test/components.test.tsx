import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import {
  Button,
  Chip,
  EmptyState,
  ICON_NAMES,
  Icon,
  IconButton,
  Menu,
  RipplePattern,
  TrailPattern,
} from '../src/index.js';

describe('components', () => {
  it('Button sizes and variants', () => {
    const html = renderToString(
      <Button variant="signal" size="lg">
        Finish
      </Button>,
    );
    expect(html).toContain('data-variant="signal"');
    expect(html).toContain('data-size="lg"');
    expect(renderToString(<Button>Save</Button>)).not.toContain('data-size');
  });

  it('IconButton is labelled and has a tooltip', () => {
    const html = renderToString(<IconButton icon="undo" label="Undo" disabled />);
    expect(html).toContain('aria-label="Undo"');
    expect(html).toContain('data-tip="Undo"');
    expect(html).toContain('disabled');
  });

  it('has every icon the brand asks for', () => {
    for (const name of [
      'undo',
      'redo',
      'history',
      'share',
      'blur',
      'palette',
      'help',
      'capture',
      'pause',
      'play',
      'finish',
      'eye',
      'eye-off',
      'copy-link',
      'check',
      'x',
      'chevron-down',
      'external',
      'settings',
      'pin',
      'note',
      'wand',
    ])
      expect(ICON_NAMES).toContain(name);
    expect(renderToString(<Icon name="wand" />)).toContain('stroke-width="1.75"');
  });

  it('EmptyState shows a pattern band, title, text and action', () => {
    const html = renderToString(
      <EmptyState title="Record your first guide" text="One sentence.">
        <Button variant="primary">Start capture</Button>
      </EmptyState>,
    );
    expect(html).toContain('ss-emptystate__band');
    expect(html).toContain('<h2>Record your first guide</h2>');
    expect(html).toContain('Start capture');
  });

  it('Chip shows a name with an optional icon', () => {
    expect(renderToString(<Chip label="localhost" />)).toContain('<span>localhost</span>');
    expect(renderToString(<Chip label="a" icon="data:," />)).toContain('<img');
  });

  it('Menu starts closed with an accessible button', () => {
    const html = renderToString(
      <Menu label="More actions" items={[{ label: 'Cancel', onSelect: () => undefined }]} />,
    );
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="menu"');
  });

  it('patterns are decorative SVG', () => {
    for (const P of [RipplePattern, TrailPattern]) {
      const html = renderToString(<P />);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('<svg');
    }
  });
});
