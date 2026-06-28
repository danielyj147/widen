import { describe, expect, it } from 'vitest';
import { cosine, tfidfVectors } from '../src/tfidf.js';
import { tokenize } from '../src/text.js';

describe('tf-idf cosine similarity', () => {
  const docs = [
    'solid state battery technology overview',
    'solid state battery technology guide',
    'spring gardening tips for beginners',
  ].map(tokenize);

  it('produces L2-normalized vectors (self-cosine = 1)', () => {
    const [v0] = tfidfVectors(docs);
    expect(cosine(v0!, v0!)).toBeCloseTo(1, 6);
  });

  it('rates near-duplicate content far more similar than unrelated content', () => {
    const [v0, v1, v2] = tfidfVectors(docs);
    const dup = cosine(v0!, v1!); // battery vs battery
    const diff = cosine(v0!, v2!); // battery vs gardening
    expect(dup).toBeGreaterThan(diff);
    expect(diff).toBe(0); // no shared terms
  });
});
