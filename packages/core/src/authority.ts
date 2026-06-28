import trancoDomains from './data/tranco-50k.json';

/**
 * Domain authority from the Tranco list — a research-grade popularity ranking
 * aggregated from multiple providers (Crux, Majestic, Umbrella, …) that is far
 * more manipulation-resistant than any single source. We vendor the top 50,000
 * registrable domains (list Y87WG, 2026-06-27; tranco-list.eu, Le Pochat et al.,
 * NDSS 2019). Rank 1 = most popular.
 *
 * NOTE: authority favors *popular* sites — the opposite of this tool's long-tail
 * goal — so its weight defaults to 0 and is opt-in (e.g. a research use case that
 * wants credibility over reach).
 */

let rankByDomain: Map<string, number> | null = null;

function ensureLoaded(): Map<string, number> {
  if (rankByDomain) return rankByDomain;
  const m = new Map<string, number>();
  (trancoDomains as string[]).forEach((d, i) => m.set(d, i + 1));
  rankByDomain = m;
  return m;
}

export const TRANCO_SIZE = (trancoDomains as string[]).length;

/**
 * Authority in [0,1] from the domain's Tranco rank on a log scale: rank 1 ≈ 1.0,
 * the bottom of the list ≈ 0, and any domain outside the top-N ≈ 0. Log scale
 * because popularity is heavy-tailed — the gap between #1 and #100 matters far
 * more than #10,000 vs #10,100.
 */
export function authorityScore(domain: string): number {
  const m = ensureLoaded();
  const d = domain.toLowerCase().replace(/^www\./, '');
  const rank = m.get(d);
  if (!rank) return 0;
  return Math.max(0, 1 - Math.log(rank) / Math.log(TRANCO_SIZE));
}
