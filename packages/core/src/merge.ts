import type { MergedSource, ProbeResult } from './types.js';
import { canonicalizeUrl, domainOf } from './url.js';

/**
 * RRF dampening constant. 60 is the value from the original Cormack et al. (2009)
 * paper and the de-facto default; it keeps any single probe's #1 result from
 * dominating, so corroboration across probes matters more than one lucky rank.
 */
export const RRF_K = 60;

function rrfContribution(position: number | undefined): number {
  // Results with no known rank contribute negligibly rather than not at all.
  return 1 / (RRF_K + (position ?? 999));
}

/**
 * Collapse every probe's raw results into a unique source set. Provenance is the
 * point: `foundByProbes` records which probes surfaced each source, which is both
 * what the dashboard shows ("this niche forum came only from the region sweep")
 * and the raw material for the recapture estimate.
 *
 * Results are returned sorted by bestPosition then by how many probes found them,
 * so the most prominent, most-corroborated sources lead.
 */
export function mergeResults(probeResults: ProbeResult[]): MergedSource[] {
  const byUrl = new Map<string, MergedSource>();

  for (const pr of probeResults) {
    for (const r of pr.results) {
      const url = canonicalizeUrl(r.url);
      const existing = byUrl.get(url);
      if (existing) {
        if (!existing.foundByProbes.includes(pr.probeId)) {
          existing.foundByProbes.push(pr.probeId);
          // RRF sums across the distinct probes that found the source.
          existing.rrfScore += rrfContribution(r.position);
        }
        if (r.position != null && r.position < existing.bestPosition) {
          existing.bestPosition = r.position;
        }
        // keep the richest title/snippet/date we've seen
        if (!existing.title && r.title) existing.title = r.title;
        if (!existing.snippet && r.snippet) existing.snippet = r.snippet;
        if (!existing.date && r.date) existing.date = r.date;
      } else {
        byUrl.set(url, {
          url,
          domain: domainOf(url),
          title: r.title,
          snippet: r.snippet,
          foundByProbes: [pr.probeId],
          bestPosition: r.position ?? 999,
          rrfScore: rrfContribution(r.position),
          bm25Score: 0, // set later by the ranking step
          relevance: 0,
          rankScore: 0,
          date: r.date,
          freshness: 0,
          authority: 0,
          source: r.source,
        });
      }
    }
  }

  // Baseline (rerank-off) order: best single-probe rank, then corroboration.
  // When reranking is on, rank.ts/orderSources reorders by relevance + MMR.
  return [...byUrl.values()].sort(
    (a, b) =>
      a.bestPosition - b.bestPosition || b.foundByProbes.length - a.foundByProbes.length,
  );
}
