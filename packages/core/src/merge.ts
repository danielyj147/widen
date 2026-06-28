import type { MergedSource, ProbeResult } from './types.js';
import { canonicalizeUrl, domainOf } from './url.js';

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
        }
        if (r.position != null && r.position < existing.bestPosition) {
          existing.bestPosition = r.position;
        }
        // keep the richest title/snippet we've seen
        if (!existing.title && r.title) existing.title = r.title;
        if (!existing.snippet && r.snippet) existing.snippet = r.snippet;
      } else {
        byUrl.set(url, {
          url,
          domain: domainOf(url),
          title: r.title,
          snippet: r.snippet,
          foundByProbes: [pr.probeId],
          bestPosition: r.position ?? 999,
          source: r.source,
        });
      }
    }
  }

  return [...byUrl.values()].sort(
    (a, b) =>
      a.bestPosition - b.bestPosition || b.foundByProbes.length - a.foundByProbes.length,
  );
}
