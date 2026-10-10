import { describe, expect, it } from 'vitest';
import { textAround } from '../src/ocr/ocr.js';

const run = (text: string, x: number, y: number) => ({
  text,
  words: [
    [0, text.length, x, y, text.length * 8, 16] as [number, number, number, number, number, number],
  ],
});

describe('text around an action (U8)', () => {
  it('puts text inside the box first, then the nearest lines, and leaves far text out', () => {
    const page = {
      width: 1280,
      height: 800,
      runs: [
        run('Email accounts@example.test', 480, 340),
        run('Supplier contact', 480, 300),
        run('Footer far away', 480, 760),
      ],
    };
    expect(textAround(page, { x: 470, y: 296, w: 640, h: 26 })).toBe(
      'Supplier contact · Email accounts@example.test',
    );
    expect(textAround(page, { x: 470, y: 296, w: 640, h: 26 }, 20)).toBe('Supplier contact');
  });
});
