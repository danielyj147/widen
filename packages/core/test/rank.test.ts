import { describe, expect, it } from 'vitest';
import { bm25Scores } from '../src/bm25.js';
import { authorityScore } from '../src/authority.js';
import { jaccard, normalize, tokenize } from '../src/text.js';
import { freshnessScore, mmrOrder, orderSources, scoreRelevance } from '../src/rank.js';
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
    rankScore: 0,
    freshness: 0,
    authority: 0,
    date: partial.date,
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

describe('mmrOrder (cosine tf-idf similarity)', () => {
  // a1 and a2 are near-duplicate CONTENT; c is unrelated content.
  const sources = [
    src({ url: 'https://a.com/1', title: 'solid state battery technology overview', rrfScore: 1.0 }),
    src({ url: 'https://a.com/2', title: 'solid state battery technology overview guide', rrfScore: 0.9 }),
    src({ url: 'https://c.com', title: 'spring gardening tips for beginners', rrfScore: 0.5 }),
  ];
  const rel = [1.0, 0.9, 0.5];

  it('diversity 0 = pure relevance order', () => {
    const ordered = mmrOrder(sources, rel, 0);
    expect(ordered.map((s) => s.url)).toEqual([
      'https://a.com/1',
      'https://a.com/2',
      'https://c.com',
    ]);
  });

  it('high diversity promotes dissimilar content over a near-duplicate', () => {
    const ordered = mmrOrder(sources, rel, 1);
    // top relevance still first; then the dissimilar doc beats the near-duplicate
    expect(ordered[0]!.url).toBe('https://a.com/1');
    expect(ordered[1]!.url).toBe('https://c.com');
  });

  it('assigns a rankScore that never increases down the order (so it matches the order)', () => {
    const ordered = mmrOrder(sources, rel, 0.5);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]!.rankScore).toBeLessThanOrEqual(ordered[i - 1]!.rankScore + 1e-9);
    }
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

  it('authority weight lifts a high-Tranco domain above a higher-relevance unknown one', () => {
    const make = () => [
      src({ url: 'https://obscure-xyz-9921.com/a', domain: 'obscure-xyz-9921.com', title: 'q', rrfScore: 0.9 }),
      src({ url: 'https://github.com/b', domain: 'github.com', title: 'q', rrfScore: 0.1 }), // top-Tranco
    ];
    // no authority weight: the higher-relevance obscure domain wins
    const off = orderSources(make(), 'q', { rerank: true, diversity: 0 });
    expect(off[0]!.domain).toBe('obscure-xyz-9921.com');
    // authority weighted strongly: the authoritative domain wins despite lower relevance
    const on = orderSources(make(), 'q', { rerank: true, diversity: 0, authorityWeight: 2 });
    expect(on[0]!.domain).toBe('github.com');
  });

  it('freshness weight lifts a recent result above a stale one', () => {
    const now = Date.parse('2026-06-01T00:00:00Z');
    const make = () => [
      src({ url: 'https://a.com', title: 'q', rrfScore: 0.5, date: '2000-01-01' }), // stale
      src({ url: 'https://b.com', title: 'q', rrfScore: 0.5, date: '2026-05-28' }), // fresh
    ];
    const off = orderSources(make(), 'q', { rerank: true, diversity: 0, now });
    expect(off[0]!.url).toBe('https://a.com'); // tie -> input order preserved
    const on = orderSources(make(), 'q', { rerank: true, diversity: 0, freshnessWeight: 1, now });
    expect(on[0]!.url).toBe('https://b.com');
  });

  it('drops sources below minRelevance from the displayed list', () => {
    const sources = [
      src({ url: 'https://a.com', title: 'battery suppliers list', rrfScore: 0.9 }),
      src({ url: 'https://b.com', title: 'unrelated cooking recipes', rrfScore: 0.1 }),
    ];
    const out = orderSources(sources, 'battery suppliers', {
      rerank: true,
      diversity: 0.45,
      minRelevance: 0.5,
    });
    expect(out.map((s) => s.domain)).toEqual(['a.com']); // b.com (relevance 0) dropped
  });
});
