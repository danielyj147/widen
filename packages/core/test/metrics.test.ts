import { describe, expect, it } from 'vitest';
import { dcgAt, ndcgAt } from '../src/metrics.js';

describe('nDCG', () => {
  it('is 1.0 when the ranking is already ideal', () => {
    expect(ndcgAt([3, 2, 1, 0], 10)).toBe(1);
  });

  it('penalizes a relevant item placed late', () => {
    const good = ndcgAt([3, 0, 0], 10);
    const bad = ndcgAt([0, 0, 3], 10);
    expect(good).toBe(1); // only one graded item, placed first => ideal
    expect(bad).toBeLessThan(good);
  });

  it('returns 0 when there is no relevance to gain', () => {
    expect(ndcgAt([0, 0, 0], 10)).toBe(0);
  });

  it('dcg applies the log2 discount', () => {
    // gains [3,3]: (2^3-1)/log2(2) + (2^3-1)/log2(3) = 7 + 7/1.585
    expect(dcgAt([3, 3], 2)).toBeCloseTo(7 + 7 / Math.log2(3), 5);
  });

  it('respects the cutoff k', () => {
    expect(dcgAt([3, 3, 3], 1)).toBe(7);
  });
});
