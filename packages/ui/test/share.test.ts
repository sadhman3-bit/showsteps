import { describe, expect, it } from 'vitest';
import { fileNameFor } from '../src/export/ShareDialog.js';

describe('export file names', () => {
  it('are stable per guide title, so saving again overwrites the same files', () => {
    const title = 'Pay a bill: AP/AR <monthly>';
    expect(fileNameFor(title, 'pdf')).toBe('Pay a bill AP AR monthly.pdf');
    expect(fileNameFor(title, 'docx')).toBe('Pay a bill AP AR monthly.docx');
    expect(fileNameFor(title, 'markdown')).toBe('Pay a bill AP AR monthly (Markdown).zip');
    expect(fileNameFor(title, 'html')).toBe('Pay a bill AP AR monthly.html');
    expect(fileNameFor(title, 'embed')).toBe('Pay a bill AP AR monthly.embed.html');
    expect(fileNameFor(title, 'trailmark')).toBe('Pay a bill AP AR monthly.trailmark');
    expect(fileNameFor('   ', 'pdf')).toBe('guide.pdf');
  });
});
