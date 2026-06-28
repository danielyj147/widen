import { describe, expect, it } from 'vitest';
import { mergeResults, rerankSources, RRF_K } from '../src/merge.js';
import type { ProbeResult } from '../src/types.js';

function pr(probeId: string, results: Array<[string, number]>): ProbeResult {
  return {
    probeId,
    status: 'ok',
    results: results.map(([url, position]) => ({ url, title: 't', snippet: 's', source: 'web', position })),
    ms: 1,
    attempts: 1,
  };
}

describe('mergeResults', () => {
  it('dedupes across probes and records provenance', () => {
    const merged = mergeResults([
      pr('p1', [['https://a.com/x', 3]]),
      pr('p2', [['http://www.a.com/x/', 1]]), // same source, different form
      pr('p3', [['https://b.com', 2]]),
    ]);
    expect(merged).toHaveLength(2);
    const a = merged.find((m) => m.domain === 'a.com')!;
    expect(a.foundByProbes.sort()).toEqual(['p1', 'p2']);
    expect(a.bestPosition).toBe(1); // best rank across probes
  });

  it('sorts by best position then corroboration', () => {
    const merged = mergeResults([
      pr('p1', [['https://low.com', 9]]),
      pr('p2', [['https://top.com', 1]]),
    ]);
    expect(merged[0]!.domain).toBe('top.com');
  });

  it('accumulates an RRF score across the distinct probes that found a source', () => {
    const merged = mergeResults([
      pr('p1', [['https://a.com', 1]]),
      pr('p2', [['https://a.com', 1]]),
    ]);
    const a = merged.find((m) => m.domain === 'a.com')!;
    // two probes, each rank 1 -> 2 / (K + 1)
    expect(a.rrfScore).toBeCloseTo(2 / (RRF_K + 1), 8);
  });
});

describe('rerankSources (RRF)', () => {
  it('ranks a corroborated source above a single-probe one at the same rank', () => {
    const merged = mergeResults([
      pr('p1', [['https://corro.com', 2]]),
      pr('p2', [['https://corro.com', 2]]),
      pr('p3', [['https://solo.com', 1]]),
    ]);
    const ranked = rerankSources(merged);
    expect(ranked[0]!.domain).toBe('corro.com'); // 2/(K+2) > 1/(K+1)
  });

  it('still scores a long-tail #1 above a popular source buried deep', () => {
    const merged = mergeResults([
      pr('p1', [['https://niche.com', 1]]), // one probe, rank 1
      pr('p2', [['https://popular.com', 40]]), // one probe, rank 40
    ]);
    const ranked = rerankSources(merged);
    expect(ranked[0]!.domain).toBe('niche.com');
  });

  it('does not mutate the input array', () => {
    const merged = mergeResults([pr('p1', [['https://a.com', 5]]), pr('p2', [['https://b.com', 1]])]);
    const before = merged.map((m) => m.url);
    rerankSources(merged);
    expect(merged.map((m) => m.url)).toEqual(before);
  });
});
