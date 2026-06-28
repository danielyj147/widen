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

/**
 * Build the full prioritized candidate list for a query. The orchestrator
 * decides how many to actually run (budget + adaptive stop). Order here encodes
 * priority: base first, then the levers most likely to widen coverage.
 */
export function deterministicProbes(query: string, cfg: RunConfig): Probe[] {
  const q = query.trim();
  const limit = cfg.perProbeLimit;
  const axes = new Set(cfg.axes);
  const sources = new Set(cfg.sources);
  const tbs = resolveTbs(cfg); // global time filter for web probes
  const out: Probe[] = [];

  // helper: a web probe that respects the global time-range filter.
  const web = (extra?: Partial<ProbeParams>): ProbeParams => ({
    limit,
    sources: ['web'],
    ...(tbs ? { tbs } : {}),
    ...extra,
  });

  // 1. base — the honest baseline; mirrors what the customer runs today.
  if (axes.has('base')) {
    out.push(mk(q, 'base', web(), 'the original query, unmodified'));
  }

  // 2. niche — user explicitly named these domains, so prioritize them: search
  //    each directly via includeDomains, surfacing content that doesn't rank in
  //    open search (the "trade pubs / niche forums it never surfaces" request).
  if (axes.has('niche')) {
    for (const domain of dedupeKeepOrder(cfg.includeDomains.map((d) => d.trim()).filter(Boolean))) {
      out.push(mk(q, 'niche', web({ includeDomains: [domain] }), `niche source: ${domain}`));
    }
  }

  // 3. source-type — the single strongest lever for the long tail. Firecrawl
  //    bills 2 credits per 10 results *per call* (rounded up), so we pack the
  //    non-web verticals into ONE call and all categories into ONE call rather
  //    than one call each — same query, same-or-fewer credits, fewer requests.
  if (axes.has('source-type')) {
    const extraSources = ([...sources].filter((s) => s !== 'web') as Array<'news' | 'images'>).sort();
    if (extraSources.length) {
      out.push(mk(q, 'source-type', { limit, sources: extraSources }, `verticals: ${extraSources.join(' · ')}`));
    }
    if (cfg.categories.length) {
      out.push(mk(q, 'source-type', { limit, categories: cfg.categories }, `categories: ${cfg.categories.join(' · ')}`));
    }
    for (const s of SOURCE_TYPE_QUERIES) {
      out.push(mk(`${q} ${s.suffix}`, 'source-type', web(), s.rationale));
    }
  }

  // 3. reformulation — re-rank the same web index from different angles.
  if (axes.has('reformulation')) {
    for (const facet of REFORMULATION_FACETS) {
      out.push(mk(`${q} ${facet}`, 'reformulation', web(), `facet: "${facet}"`));
    }
  }

  // 4. time — recency-biased ranking; time filters expose other sources. Skipped
  //    when the user pinned a global time range (that filter already applies).
  if (axes.has('time') && !tbs) {
    out.push(mk(q, 'time', { limit, sources: ['web'], tbs: 'qdr:y' }, 'past year only'));
    out.push(mk(q, 'time', { limit, sources: ['web'], tbs: 'qdr:m' }, 'past month: freshest sources'));
    out.push(mk(q, 'time', { limit, sources: ['web'], tbs: 'sbd:1' }, 'sorted by date, newest first'));
  }

  // 5. region — location sweep for regional publishers.
  if (axes.has('region')) {
    const regions = cfg.location ? [cfg.location, ...cfg.regions] : cfg.regions;
    for (const region of dedupeKeepOrder(regions)) {
      out.push(mk(q, 'region', web({ location: region }), `regional results: ${region}`));
    }
  }

  return dedupeProbes(out);
}

/**
 * Resolve the time-based-search filter for web probes. A precise `maxAgeDays`
 * wins (a Firecrawl custom date range, results no older than N days); otherwise
 * the `timeRange` preset (qdr:*); otherwise none.
 */
function resolveTbs(cfg: RunConfig): string | undefined {
  if (cfg.maxAgeDays && cfg.maxAgeDays > 0) {
    const max = new Date();
    const min = new Date(max.getTime() - cfg.maxAgeDays * 86_400_000);
    const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    return `cdr:1,cd_min:${fmt(min)},cd_max:${fmt(max)}`;
  }
  return cfg.timeRange || undefined;
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
