import { describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import type { SearchClient } from '../src/firecrawl.js';
import type { Probe, ProbeResult } from '../src/types.js';

/** A deterministic fake: each probe returns a couple of urls derived from its id. */
class FakeClient implements SearchClient {
  calls: string[] = [];
  constructor(private readonly behavior?: (p: Probe) => ProbeResult) {}
  async run(probe: Probe): Promise<ProbeResult> {
    this.calls.push(probe.id);
    if (this.behavior) return this.behavior(probe);
    return {
      probeId: probe.id,
      status: 'ok',
      results: [
        { url: `https://${probe.id}-a.com`, title: 'a', snippet: '', source: 'web', position: 1 },
        { url: `https://${probe.id}-b.com`, title: 'b', snippet: '', source: 'web', position: 2 },
      ],
      ms: 1,
      attempts: 1,
    };
  }
}

const fixedId = () => 'run-test';

describe('run (integration)', () => {
  it('produces a complete artifact and respects the budget', async () => {
    const client = new FakeClient();
    const artifact = await run('renewable energy', {
      client,
      config: { budget: 6, concurrency: 3, llm: false },
      idGen: fixedId,
    });
    expect(artifact.id).toBe('run-test');
    expect(artifact.probeResults.length).toBeLessThanOrEqual(6);
    expect(artifact.sources.length).toBeGreaterThan(0);
    expect(artifact.coverage.probesIssued).toBe(artifact.probeResults.length);
    // each fake probe yields 2 unique domains
    expect(artifact.coverage.uniqueDomains).toBe(artifact.probeResults.length * 2);
  });

  it('stops early when a wave adds no new domains (saturation)', async () => {
    // every probe returns the SAME single domain -> saturates immediately
    const client = new FakeClient((p) => ({
      probeId: p.id,
      status: 'ok',
      results: [{ url: 'https://same.com', title: '', snippet: '', source: 'web', position: 1 }],
      ms: 1,
      attempts: 1,
    }));
    const artifact = await run('q', {
      client,
      config: { budget: 24, concurrency: 2, saturationMinNewDomains: 2, saturationPatience: 2, llm: false },
      idGen: fixedId,
    });
    expect(artifact.coverage.stopReason).toBe('saturated');
    // should stop well before the budget of 24
    expect(artifact.probeResults.length).toBeLessThan(24);
  });

  it('keeps a failed probe from sinking the run', async () => {
    const client = new FakeClient((p) =>
      p.axis === 'time'
        ? { probeId: p.id, status: 'rate-limited', results: [], error: '429', ms: 1, attempts: 3 }
        : { probeId: p.id, status: 'ok', results: [{ url: `https://${p.id}.com`, title: '', snippet: '', source: 'web', position: 1 }], ms: 1, attempts: 1 },
    );
    const artifact = await run('q', {
      client,
      config: { budget: 24, concurrency: 6, llm: false },
      idGen: fixedId,
    });
    expect(artifact.coverage.probesFailed).toBeGreaterThan(0);
    expect(artifact.sources.length).toBeGreaterThan(0);
    expect(artifact.coverage.failures.every((f) => f.status === 'rate-limited')).toBe(true);
  });
});
