import { createHash } from 'node:crypto';
import type { Probe, ProbeAxis, ProbeParams, RunConfig } from '../types.js';

/** Stable id from the probe's identity (query + params), so runs are reproducible. */
export function probeId(query: string, params: ProbeParams): string {
  const sig = JSON.stringify({ q: query.toLowerCase().trim(), p: sortedParams(params) });
  return createHash('sha1').update(sig).digest('hex').slice(0, 10);
}

function sortedParams(p: ProbeParams): ProbeParams {
  return {
    limit: p.limit,
    sources: p.sources ? [...p.sources].sort() : undefined,
    categories: p.categories ? [...p.categories].sort() : undefined,
    tbs: p.tbs,
    location: p.location,
    includeDomains: p.includeDomains ? [...p.includeDomains].sort() : undefined,
    excludeDomains: p.excludeDomains ? [...p.excludeDomains].sort() : undefined,
  };
}

function mk(query: string, axis: ProbeAxis, params: ProbeParams, rationale: string): Probe {
  return { id: probeId(query, params), query, axis, params, rationale };
}

/**
 * Curated, high-signal reformulations. We keep this list short on purpose:
 * noisy generic modifiers ("guide", "explained") mostly return the same SEO
 * winners. These facets tend to pull genuinely different SERPs.
 */
const REFORMULATION_FACETS = [
  'analysis',
  'report',
  'alternatives',
  'case study',
  'criticism',
];

/** Operators/keywords that bias toward community and long-tail publishers. */
const SOURCE_TYPE_QUERIES: Array<{ suffix: string; rationale: string }> = [
  { suffix: 'forum discussion', rationale: 'community forums and niche boards' },
  { suffix: 'blog', rationale: 'independent blogs outside the SEO front page' },
];

/** A small default region sweep. Each reorders the SERP and surfaces regional press. */
const DEFAULT_REGIONS = ['United States', 'United Kingdom', 'India', 'Australia', 'Germany'];

/**
 * Build the full prioritized candidate list for a query. The orchestrator
 * decides how many to actually run (budget + adaptive stop). Order here encodes
 * priority: base first, then the levers most likely to widen coverage.
 */
export function deterministicProbes(query: string, cfg: RunConfig): Probe[] {
  const q = query.trim();
  const limit = cfg.perProbeLimit;
  const axes = new Set(cfg.axes);
  const out: Probe[] = [];

  // 1. base — the honest baseline; mirrors what the customer runs today.
  if (axes.has('base')) {
    out.push(mk(q, 'base', { limit, sources: ['web'] }, 'the original query, unmodified'));
  }

  // 2. source-type — the single strongest lever for the long tail.
  if (axes.has('source-type')) {
    out.push(mk(q, 'source-type', { limit, sources: ['news'] }, 'news vertical: trade and regional press'));
    out.push(mk(q, 'source-type', { limit, categories: ['research'] }, 'academic and research sources'));
    out.push(mk(q, 'source-type', { limit, categories: ['pdf'] }, 'PDF reports and whitepapers'));
    for (const s of SOURCE_TYPE_QUERIES) {
      out.push(mk(`${q} ${s.suffix}`, 'source-type', { limit, sources: ['web'] }, s.rationale));
    }
  }

  // 3. reformulation — re-rank the same web index from different angles.
  if (axes.has('reformulation')) {
    for (const facet of REFORMULATION_FACETS) {
      out.push(
        mk(`${q} ${facet}`, 'reformulation', { limit, sources: ['web'] }, `facet: "${facet}"`),
      );
    }
  }

  // 4. time — popularity ranking is recency-biased; time filters expose other sources.
  if (axes.has('time')) {
    out.push(mk(q, 'time', { limit, sources: ['web'], tbs: 'qdr:y' }, 'past year only'));
    out.push(mk(q, 'time', { limit, sources: ['web'], tbs: 'qdr:m' }, 'past month: freshest sources'));
    out.push(mk(q, 'time', { limit, sources: ['web'], tbs: 'sbd:1' }, 'sorted by date, newest first'));
  }

  // 5. region — location sweep for regional publishers. A user --location biases it.
  if (axes.has('region')) {
    const regions = cfg.location ? [cfg.location, ...DEFAULT_REGIONS] : DEFAULT_REGIONS;
    for (const region of dedupeKeepOrder(regions)) {
      out.push(
        mk(q, 'region', { limit, sources: ['web'], location: region }, `regional results: ${region}`),
      );
    }
  }

  return dedupeProbes(out);
}

function dedupeKeepOrder(xs: string[]): string[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
}

/** Drop probes with identical ids (same query+params), keeping first/highest-priority. */
export function dedupeProbes(probes: Probe[]): Probe[] {
  const seen = new Set<string>();
  const out: Probe[] = [];
  for (const p of probes) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
