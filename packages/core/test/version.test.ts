import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME, SCHEMA_VERSION } from '../src/index.js';

describe('core package', () => {
  it('exposes the schema version', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('exposes the product name', () => {
    expect(PRODUCT_NAME).toBe('Trailmark');
  });
});
