import { bm25Scores } from './bm25.js';
import { jaccard, normalize, tokenize } from './text.js';
import type { MergedSource } from './types.js';

/**
 * How much each relevance signal counts. RRF (cross-probe rank corroboration) is
 * the robust signal and leads; BM25 (lexical match to the original query) is a
 * noisier re-grounding nudge and follows. Tuned, not learned — and explainable.
 */
const W_RRF = 0.65;
const W_BM25 = 0.35;

/** Same-domain sources are treated as at least this similar, so MMR spreads
 *  across domains (the brief's "source diversity"), not just across wording. */
const SAME_DOMAIN_SIM = 0.7;

export interface RankOptions {
  /** false => leave discovery order untouched. */
  rerank: boolean;
  /** 0 => pure relevance, 1 => maximum source diversity (MMR λ = 1 - diversity). */
  diversity: number;
}

/**
 * Compute a blended relevance in [0,1] for each source and write it (plus the
 * raw BM25) back onto the source, so the artifact explains why things ranked.
 * Returns the relevance array aligned to `sources`.
 */
export function scoreRelevance(sources: MergedSource[], query: string): number[] {
  const bm25 = bm25Scores(
    query,
    sources.map((s) => `${s.title} ${s.snippet}`),
  );
  const normRrf = normalize(sources.map((s) => s.rrfScore));
  const normBm25 = normalize(bm25);
  return sources.map((s, i) => {
    const rel = W_RRF * normRrf[i]! + W_BM25 * normBm25[i]!;
    s.bm25Score = bm25[i]!;
    s.relevance = rel;
    return rel;
  });
}

function similarity(a: MergedSource, aTok: Set<string>, b: MergedSource, bTok: Set<string>): number {
  const lexical = jaccard(aTok, bTok);
  if (a.domain === b.domain) return Math.max(SAME_DOMAIN_SIM, lexical);
  return lexical;
}

/**
 * Maximal Marginal Relevance reordering.
 *
 *   pick argmax_{d ∉ S} [ λ·Rel(d) − (1−λ)·max_{s ∈ S} Sim(d, s) ]
 *
 * λ = 1 − diversity. At diversity 0 this is pure relevance order; as diversity
 * rises, each pick is penalized for resembling what's already chosen (same
 * domain, or overlapping title/snippet), spreading sources out. O(n²) over the
 * result set, which is small (tens–low hundreds).
 */
export function mmrOrder(sources: MergedSource[], relevance: number[], diversity: number): MergedSource[] {
  const lambda = 1 - clamp01(diversity);
  const toks = sources.map((s) => new Set(tokenize(`${s.title} ${s.snippet}`)));
  const remaining = sources.map((_, i) => i);
  const selected: number[] = [];

  while (remaining.length > 0) {
    let bestPos = 0;
    let bestScore = -Infinity;
    for (let r = 0; r < remaining.length; r++) {
      const i = remaining[r]!;
      let maxSim = 0;
      for (const j of selected) {
        const sim = similarity(sources[i]!, toks[i]!, sources[j]!, toks[j]!);
        if (sim > maxSim) maxSim = sim;
      }
      const score = lambda * relevance[i]! - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestPos = r;
      }
    }
    selected.push(remaining[bestPos]!);
    remaining.splice(bestPos, 1);
  }
  return selected.map((i) => sources[i]!);
}

/**
 * The single entry point run() uses. Mutates relevance/bm25 onto the sources for
 * transparency, then returns them ordered per the options.
 */
export function orderSources(sources: MergedSource[], query: string, opts: RankOptions): MergedSource[] {
  if (!opts.rerank || sources.length === 0) {
    // still annotate relevance so the dashboard can show it, but keep order.
    if (sources.length) scoreRelevance(sources, query);
    return sources;
  }
  const relevance = scoreRelevance(sources, query);
  return mmrOrder(sources, relevance, opts.diversity);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
