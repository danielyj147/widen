import { describe, expect, it } from 'vitest';
import { authorityScore, TRANCO_SIZE } from '../src/authority.js';
import { freshnessScore } from '../src/rank.js';

describe('authorityScore (Tranco)', () => {
  it('loaded a sizable list', () => {
    expect(TRANCO_SIZE).toBeGreaterThan(10_000);
  });

  it('scores well-known domains high and unknown ones zero', () => {
    expect(authorityScore('google.com')).toBeGreaterThan(0.9);
    expect(authorityScore('totally-not-a-real-domain-zzz999.test')).toBe(0);
  });

  it('is monotonic in popularity (more popular = higher)', () => {
    // google.com is rank ~1; a mid-list site is far lower
    expect(authorityScore('google.com')).toBeGreaterThan(authorityScore('github.com'));
  });

  it('ignores leading www', () => {
    expect(authorityScore('www.google.com')).toBe(authorityScore('google.com'));
  });
});

describe('freshnessScore', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');

  it('decays with age (today ~1, ~0.5 at 30d, low at a year)', () => {
    expect(freshnessScore('2026-06-01', now)).toBeCloseTo(1, 5);
    expect(freshnessScore('2026-05-02', now)).toBeCloseTo(0.5, 1);
    expect(freshnessScore('2025-06-01', now)).toBeLessThan(0.15);
  });

  it('treats undated / unparseable as neutral-low', () => {
    expect(freshnessScore(undefined, now)).toBe(0.3);
    expect(freshnessScore('not a date', now)).toBe(0.3);
  });
});
