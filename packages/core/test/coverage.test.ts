import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { buildCoverage, chao1, domainIncidence, saturationCurve } from '../src/coverage.js';
import { mergeResults } from '../src/merge.js';
import type { MergedSource, Probe, ProbeResult } from '../src/types.js';

describe('chao1', () => {
  it('estimates unseen domains from singletons and doubletons', () => {
    // 10 observed domains, 6 singletons, 2 doubletons -> 10 + 36/4 = 19
    const incidence = [1, 1, 1, 1, 1, 1, 2, 2, 3, 3];
    const est = chao1(incidence);
    expect(est.observedDomains).toBe(10);
    expect(est.singletons).toBe(6);
    expect(est.doubletons).toBe(2);
    expect(est.estimatedTotalDomains).toBe(19);
    expect(est.coverage).toBeCloseTo(10 / 19, 5);
    expect(est.method).toBe('chao1');
  });

  it('uses bias-corrected form when no doubletons', () => {
    const est = chao1([1, 1, 1, 3]); // f1=3,f2=0 -> 4 + 3*2/2 = 7
    expect(est.method).toBe('chao1-bias-corrected');
    expect(est.estimatedTotalDomains).toBe(7);
  });

  it('reports coverage 100% when everything is well-sampled', () => {
    const est = chao1([3, 3, 4, 5]); // no singletons -> estimate == observed
    expect(est.coverage).toBe(1);
  });

  it('handles the empty case', () => {
    const est = chao1([]);
    expect(est.coverage).toBeNull();
    expect(est.method).toBe('insufficient-data');
  });
});

describe('domainIncidence', () => {
  it('counts distinct probes per domain across multiple urls', () => {
    const sources: MergedSource[] = [
      { url: 'https://a.com/1', domain: 'a.com', title: '', snippet: '', foundByProbes: ['p1'], bestPosition: 1, rrfScore: 0, bm25Score: 0, relevance: 0, rankScore: 0, freshness: 0, authority: 0, source: 'web' },
      { url: 'https://a.com/2', domain: 'a.com', title: '', snippet: '', foundByProbes: ['p2'], bestPosition: 2, rrfScore: 0, bm25Score: 0, relevance: 0, rankScore: 0, freshness: 0, authority: 0, source: 'web' },
      { url: 'https://b.com', domain: 'b.com', title: '', snippet: '', foundByProbes: ['p1'], bestPosition: 1, rrfScore: 0, bm25Score: 0, relevance: 0, rankScore: 0, freshness: 0, authority: 0, source: 'web' },
    ];
    // a.com seen by p1+p2 => 2; b.com by p1 => 1
    expect(domainIncidence(sources).sort()).toEqual([1, 2]);
  });
});

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
  const probes: Probe[] = ['p1', 'p2', 'p3'].map((id) => ({
    id, query: 'q', axis: 'base', params: {}, rationale: '',
  }));

  it('flags thin coverage when many domains are singletons', () => {
    const results = [
      pr('p1', ['https://a.com', 'https://b.com', 'https://c.com']),
      pr('p2', ['https://d.com', 'https://e.com']),
      pr('p3', ['https://f.com', 'https://g.com']),
    ];
    const sources = mergeResults(results);
    const cov = buildCoverage(probes, results, sources, cfg, 'probes-exhausted');
    expect(cov.verdict).toBe('thin');
    expect(cov.uniqueDomains).toBe(7);
  });

  it('records failures as first-class', () => {
    const failing: ProbeResult = { probeId: 'p2', status: 'rate-limited', results: [], error: '429', ms: 1, attempts: 3 };
    const results = [pr('p1', ['https://a.com']), failing];
    const cov = buildCoverage(probes, results, mergeResults(results), cfg, 'probes-exhausted');
    expect(cov.probesFailed).toBe(1);
    expect(cov.failures[0]!.status).toBe('rate-limited');
  });
});
