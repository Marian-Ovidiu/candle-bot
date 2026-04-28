import { describe, expect, it } from 'vitest';
import { pctChange, roundTo, safeDiv } from './math';

describe('math utilities', () => {
  it('handles division by zero safely', () => {
    expect(safeDiv(10, 0)).toBe(0);
    expect(safeDiv(10, 2)).toBe(5);
  });

  it('computes percentage change from a base value', () => {
    expect(pctChange(110, 100)).toBe(0.1);
    expect(pctChange(90, 100)).toBe(-0.1);
  });

  it('rounds to the requested decimals', () => {
    expect(roundTo(1.23456, 2)).toBe(1.23);
    expect(roundTo(1.23556, 2)).toBe(1.24);
  });
});
