import { describe, expect, it } from 'vitest';
import { bm25Scores } from '../src/bm25.js';
import { jaccard, normalize, tokenize } from '../src/text.js';
import { mmrOrder, orderSources, scoreRelevance } from '../src/rank.js';
import type { MergedSource } from '../src/types.js';

function src(partial: Partial<MergedSource> & { url: string }): MergedSource {
  return {
    url: partial.url,
    domain: partial.domain ?? new URL(partial.url).hostname.replace(/^www\./, ''),
    title: partial.title ?? '',
    snippet: partial.snippet ?? '',
    foundByProbes: partial.foundByProbes ?? ['p1'],
    bestPosition: partial.bestPosition ?? 1,
    rrfScore: partial.rrfScore ?? 0,
    bm25Score: 0,
    relevance: 0,
    source: 'web',
  };
}

describe('text utils', () => {
  it('tokenizes, lowercases, drops stopwords and 1-char tokens', () => {
    expect(tokenize('The BEST EV charging Standards!')).toEqual(['best', 'ev', 'charging', 'standards']);
  });
  it('jaccard overlap', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3, 6);
    expect(jaccard(new Set(['a']), new Set())).toBe(0);
  });
  it('normalize maps to [0,1] and handles constant input', () => {
    expect(normalize([0, 5, 10])).toEqual([0, 0.5, 1]);
    expect(normalize([3, 3, 3])).toEqual([0, 0, 0]);
  });
});

describe('bm25Scores', () => {
  it('scores a doc that matches the query above one that does not', () => {
    const docs = ['solid state battery suppliers list', 'unrelated gardening tips'];
    const [a, b] = bm25Scores('solid state battery', docs);
    expect(a!).toBeGreaterThan(b!);
    expect(b!).toBe(0);
  });
  it('returns zeros when query has no usable terms', () => {
    expect(bm25Scores('the a of', ['anything here'])).toEqual([0]);
  });
});

describe('scoreRelevance (RRF fuses probe lists + BM25 list)', () => {
  it('writes normalized relevance and raw bm25 back onto sources', () => {
    const sources = [
      src({ url: 'https://a.com', title: 'battery suppliers', rrfScore: 0.03 }),
      src({ url: 'https://b.com', title: 'cooking recipes', rrfScore: 0.01 }),
    ];
    const rel = scoreRelevance(sources, 'battery suppliers');
    expect(sources[0]!.relevance).toBe(rel[0]);
    expect(sources[0]!.relevance).toBeGreaterThan(sources[1]!.relevance);
    expect(sources[0]!.bm25Score).toBeGreaterThan(0);
  });

  it('a higher BM25 weight lifts the query-matching source even past higher RRF', () => {
    const make = () => [
      src({ url: 'https://hi-rrf.com', title: 'unrelated', rrfScore: 0.05 }), // strong probe corroboration, off-topic
      src({ url: 'https://hi-bm25.com', title: 'battery suppliers list', rrfScore: 0.01 }), // weak probes, on-topic
    ];
    const lowW = make();
    scoreRelevance(lowW, 'battery suppliers', 0);
    expect(lowW[0]!.relevance).toBeGreaterThan(lowW[1]!.relevance); // RRF-only: corroboration wins

    const highW = make();
    scoreRelevance(highW, 'battery suppliers', 20);
    expect(highW[1]!.relevance).toBeGreaterThan(highW[0]!.relevance); // BM25 grounding flips it
  });
});

describe('mmrOrder', () => {
  const sources = [
    src({ url: 'https://a.com/1', domain: 'a.com', title: 'x', rrfScore: 1.0 }),
    src({ url: 'https://a.com/2', domain: 'a.com', title: 'x', rrfScore: 0.9 }),
    src({ url: 'https://b.com', domain: 'b.com', title: 'y', rrfScore: 0.5 }),
  ];
  const rel = [1.0, 0.9, 0.5];

  it('diversity 0 = pure relevance order (two same-domain first)', () => {
    const ordered = mmrOrder(sources, rel, 0);
    expect(ordered.map((s) => s.url)).toEqual(['https://a.com/1', 'https://a.com/2', 'https://b.com']);
  });

  it('high diversity promotes a different domain over a same-domain duplicate', () => {
    const ordered = mmrOrder(sources, rel, 1);
    // top relevance still first; then the different domain beats the a.com twin
    expect(ordered[0]!.url).toBe('https://a.com/1');
    expect(ordered[1]!.domain).toBe('b.com');
  });
});

describe('orderSources', () => {
  it('leaves order untouched but still annotates relevance when rerank is off', () => {
    const sources = [
      src({ url: 'https://b.com', title: 'battery', rrfScore: 0.2 }),
      src({ url: 'https://a.com', title: 'battery', rrfScore: 0.9 }),
    ];
    const out = orderSources(sources, 'battery', { rerank: false, diversity: 0.45 });
    expect(out.map((s) => s.url)).toEqual(['https://b.com', 'https://a.com']); // unchanged
    // relevance is still computed/annotated even when order is preserved
    expect(out[1]!.relevance).toBeGreaterThan(0);
  });

  it('reorders by relevance when rerank is on', () => {
    const sources = [
      src({ url: 'https://b.com', title: 'cooking', rrfScore: 0.2 }),
      src({ url: 'https://a.com', title: 'battery suppliers', rrfScore: 0.9 }),
    ];
    const out = orderSources(sources, 'battery suppliers', { rerank: true, diversity: 0.45 });
    expect(out[0]!.url).toBe('https://a.com');
  });
});
