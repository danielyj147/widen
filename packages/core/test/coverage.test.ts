import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { buildCoverage, lincolnPetersen, partitionSamples, saturationCurve } from '../src/coverage.js';
import { mergeResults } from '../src/merge.js';
import type { MergedSource, Probe, ProbeResult } from '../src/types.js';

describe('lincolnPetersen', () => {
  it('estimates the total from two samples and their overlap (Chapman)', () => {
    // n1=10, n2=10, m=5 -> (11*11)/6 - 1 = 19.17 -> 19; observed 15
    const est = lincolnPetersen(10, 10, 5, 15);
    expect(est.method).toBe('lincoln-petersen');
    expect(est.estimatedTotalDomains).toBe(19);
    expect(est.coverage).toBeCloseTo(15 / 19.1667, 2);
  });

  it('estimates near-complete coverage when the samples overlap heavily', () => {
    // n1=n2=m=10 -> (11*11)/11 - 1 = 10; observed 10 -> coverage 1.0
    const est = lincolnPetersen(10, 10, 10, 10);
    expect(est.coverage).toBe(1);
  });

  it('estimates a huge pool when the two samples barely overlap', () => {
    const est = lincolnPetersen(10, 10, 1, 19); // (121/2)-1 = 59.5
    expect(est.estimatedTotalDomains).toBe(60);
    expect(est.coverage!).toBeLessThan(0.35);
  });

  it('cannot estimate from a single sample', () => {
    expect(lincolnPetersen(10, 0, 0, 10).coverage).toBeNull();
    expect(lincolnPetersen(0, 0, 0, 0).method).toBe('insufficient-data');
  });
});

describe('partitionSamples', () => {
  it('splits websites by original-query (sample 1) vs expanded-query (sample 2)', () => {
    const probes = new Map<string, Probe>([
      ['orig', { id: 'orig', query: 'electric cars', axis: 'base', params: {}, rationale: '' }],
      ['exp', { id: 'exp', query: 'electric cars review', axis: 'reformulation', params: {}, rationale: '' }],
    ]);
    const sources: MergedSource[] = [
      mkSource('https://a.com', ['orig']), // sample 1 only
      mkSource('https://b.com', ['exp']), // sample 2 only
      mkSource('https://c.com', ['orig', 'exp']), // both -> overlap
    ];
    const p = partitionSamples(sources, probes, 'electric cars');
    expect(p.n1).toBe(2); // a, c
    expect(p.n2).toBe(2); // b, c
    expect(p.overlap).toBe(1); // c
    expect(p.observed).toBe(3);
  });
});

function mkSource(url: string, foundByProbes: string[]): MergedSource {
  return {
    url, domain: new URL(url).hostname, title: '', snippet: '', foundByProbes, bestPosition: 1,
    rrfScore: 0, bm25Score: 0, relevance: 0, rankScore: 0, freshness: 0, authority: 0, source: 'web',
  };
}

function pr(probeId: string, urls: string[]): ProbeResult {
  return {
    probeId,
    status: urls.length ? 'ok' : 'empty',
    results: urls.map((u, i) => ({ url: u, title: '', snippet: '', source: 'web' as const, position: i + 1 })),
    ms: 1,
    attempts: 1,
  };
}

describe('saturationCurve', () => {
  it('tracks cumulative and per-probe new domains in order', () => {
    const results = [pr('p1', ['https://a.com', 'https://b.com']), pr('p2', ['https://a.com', 'https://c.com'])];
    const sources = mergeResults(results);
    const byProbe = new Map<string, MergedSource[]>();
    for (const s of sources) for (const id of s.foundByProbes) {
      byProbe.set(id, [...(byProbe.get(id) ?? []), s]);
    }
    const curve = saturationCurve(['p1', 'p2'], byProbe);
    expect(curve[0]!.cumulativeDomains).toBe(2);
    expect(curve[1]!.newDomains).toBe(1); // only c.com is new
    expect(curve[1]!.cumulativeDomains).toBe(3);
  });
});

describe('buildCoverage verdict', () => {
  const cfg = resolveConfig({ saturationMinNewDomains: 2, saturationPatience: 2 });
  // p1 = original query (sample 1); p2/p3 = expanded queries (sample 2)
  const probes: Probe[] = [
    { id: 'p1', query: 'q', axis: 'base', params: {}, rationale: '' },
    { id: 'p2', query: 'q review', axis: 'reformulation', params: {}, rationale: '' },
    { id: 'p3', query: 'q guide', axis: 'reformulation', params: {}, rationale: '' },
  ];

  it('flags thin coverage when the two samples barely overlap', () => {
    const results = [
      pr('p1', ['https://a.com', 'https://b.com', 'https://c.com']),
      pr('p2', ['https://d.com', 'https://e.com']),
      pr('p3', ['https://f.com', 'https://g.com']),
    ];
    const sources = mergeResults(results);
    const cov = buildCoverage(probes, results, sources, cfg, 'probes-exhausted', 'q');
    expect(cov.recapture.method).toBe('lincoln-petersen');
    expect(cov.recapture.overlap).toBe(0); // disjoint samples
    expect(cov.verdict).toBe('thin');
    expect(cov.uniqueDomains).toBe(7);
  });

  it('records failures as first-class', () => {
    const failing: ProbeResult = { probeId: 'p2', status: 'rate-limited', results: [], error: '429', ms: 1, attempts: 3 };
    const results = [pr('p1', ['https://a.com']), failing];
    const cov = buildCoverage(probes, results, mergeResults(results), cfg, 'probes-exhausted', 'q');
    expect(cov.probesFailed).toBe(1);
    expect(cov.failures[0]!.status).toBe('rate-limited');
  });
});
