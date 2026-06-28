import { randomUUID } from 'node:crypto';
import { readLlmEnv, resolveConfig, type LlmEnv } from './config.js';
import { buildCoverage } from './coverage.js';
import { expand } from './expand/index.js';
import type { SearchClient } from './firecrawl.js';
import { mergeResults } from './merge.js';
import { orderSources } from './rank.js';
import type {
  Probe,
  ProbeResult,
  RunArtifact,
  RunConfig,
  StopReason,
} from './types.js';
import { domainOf } from './url.js';

export type ProgressEvent =
  | { type: 'expanded'; probeCount: number; llmUsed: boolean; llmError?: string }
  | { type: 'wave-start'; wave: number; size: number; issued: number; budget: number }
  | { type: 'probe-done'; result: ProbeResult; probe: Probe }
  | { type: 'wave-end'; wave: number; newDomains: number; cumulativeDomains: number }
  | { type: 'stopping'; reason: StopReason };

export interface RunOptions {
  client: SearchClient;
  config?: Partial<RunConfig>;
  llmEnv?: LlmEnv;
  onProgress?: (ev: ProgressEvent) => void;
  /** overridable for deterministic tests. */
  idGen?: () => string;
  now?: () => number;
}

/** Run the full pipeline for one query and return a complete, serializable artifact. */
export async function run(query: string, opts: RunOptions): Promise<RunArtifact> {
  const cfg = resolveConfig(opts.config);
  const llmEnv = opts.llmEnv ?? readLlmEnv();
  const now = opts.now ?? Date.now;
  const emit = opts.onProgress ?? (() => {});
  const startedAt = now();

  const { probes: allCandidates, llmUsed, llmError } = await expand(query, cfg, llmEnv);
  emit({ type: 'expanded', probeCount: allCandidates.length, llmUsed, llmError });

  const candidates = allCandidates.slice(0, cfg.budget);
  const cappedByBudget = allCandidates.length > candidates.length;

  const executed: ProbeResult[] = [];
  const executedProbes: Probe[] = [];
  const seenDomains = new Set<string>();
  let lowYieldWaves = 0;
  let stopReason: StopReason = cappedByBudget ? 'budget-exhausted' : 'probes-exhausted';
  let wave = 0;

  for (let i = 0; i < candidates.length; i += cfg.concurrency) {
    const batch = candidates.slice(i, i + cfg.concurrency);
    wave++;
    emit({
      type: 'wave-start',
      wave,
      size: batch.length,
      issued: executed.length,
      budget: cfg.budget,
    });

    const results = await Promise.all(
      batch.map(async (probe) => {
        const result = await opts.client.run(probe, {
          maxRetries: cfg.maxRetries,
          timeoutMs: cfg.perProbeTimeoutMs,
        });
        emit({ type: 'probe-done', result, probe });
        return { probe, result };
      }),
    );

    let waveNewDomains = 0;
    for (const { probe, result } of results) {
      executed.push(result);
      executedProbes.push(probe);
      for (const r of result.results) {
        const d = domainOf(r.url);
        if (!seenDomains.has(d)) {
          seenDomains.add(d);
          waveNewDomains++;
        }
      }
    }
    emit({ type: 'wave-end', wave, newDomains: waveNewDomains, cumulativeDomains: seenDomains.size });

    // Adaptive stop: a wave that surfaced almost nothing new is evidence of
    // saturation. Require `patience` consecutive low-yield waves to avoid
    // stopping on one unlucky batch.
    if (waveNewDomains < cfg.saturationMinNewDomains) {
      lowYieldWaves++;
      if (lowYieldWaves >= cfg.saturationPatience) {
        stopReason = 'saturated';
        emit({ type: 'stopping', reason: stopReason });
        break;
      }
    } else {
      lowYieldWaves = 0;
    }
  }

  const merged = mergeResults(executed);
  // Coverage is order-independent; ordering is presentation. Default: relevance
  // (RRF + BM25) diversified by MMR. --no-rerank keeps discovery order.
  const sources = orderSources(merged, query, { rerank: cfg.rerank, diversity: cfg.diversity });
  const coverage = buildCoverage(executedProbes, executed, sources, cfg, stopReason);
  const finishedAt = now();

  return {
    schemaVersion: 1,
    id: opts.idGen ? opts.idGen() : randomUUID(),
    query,
    createdAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    config: cfg,
    probes: executedProbes,
    probeResults: executed,
    sources,
    coverage,
    // Firecrawl /search bills roughly per result returned (≈1 credit/result;
    // we never scrape, so no scrape surcharge). This is an estimate.
    estimatedCredits: coverage.totalRawResults,
  };
}
