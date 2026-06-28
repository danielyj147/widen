import { bm25Scores } from './bm25.js';
import { RRF_K } from './merge.js';
import { jaccard, normalize, tokenize } from './text.js';
import type { MergedSource } from './types.js';

/**
 * How many "votes" the BM25 ranked list gets in the fusion, in units of probe
 * lists. NOT a guessed magic number and NOT a customer knob: chosen by offline
 * evaluation (`npm run eval:rank`, nDCG@10 with an LLM relevance judge).
 *
 * The eval (deepseek-r1:14b judge) found BM25 did NOT improve relevance ranking
 * and slightly hurt it, monotonically worse with weight (rrf_only 0.388 >
 * rrf+bm25@5 0.359 > … > bm25_only 0.163). So it defaults to 0: BM25 is still
 * computed and shown for transparency, but kept OUT of the default fusion until
 * evidence (more topics / a stronger judge) justifies it. Kept as a swept
 * argument so re-evaluation is one command, not a code change.
 */
export const DEFAULT_BM25_WEIGHT = 0;

export interface RankOptions {
  /** false => leave discovery order untouched (still annotate relevance). */
  rerank: boolean;
  /** MMR diversity in [0,1]: 0 = pure relevance, 1 = max source spread. */
  diversity: number;
  /** override BM25 fusion weight (evaluation only). */
  bm25Weight?: number;
}

/** Same-domain results are the same *source*, so fully redundant for source
 *  diversity. 1.0 (not a tuned constant): two pages from nytimes.com are one
 *  source no matter how different the articles. Cross-domain redundancy is
 *  caught by lexical overlap instead. */
const SAME_DOMAIN_SIM = 1.0;

/**
 * Relevance via a SINGLE Reciprocal Rank Fusion over every ranked list we have:
 *
 *   - one list per probe (Firecrawl's ranking for that query variant), already
 *     summed into `s.rrfScore` during merge, and
 *   - one list from BM25 of title+snippet vs the ORIGINAL query.
 *
 * BM25 is itself a ranking, so it joins the fusion as another list rather than
 * being score-blended — RRF needs only ranks, which is the whole reason it's the
 * right tool when score scales are incomparable. The fused score is min-max
 * normalized to [0,1] so it's comparable to the similarity term in MMR.
 *
 * Writes `bm25Score` and `relevance` back onto each source for transparency.
 */
export function scoreRelevance(
  sources: MergedSource[],
  query: string,
  bm25Weight = DEFAULT_BM25_WEIGHT,
): number[] {
  const bm25 = bm25Scores(
    query,
    sources.map((s) => `${s.title} ${s.snippet}`),
  );

  // Rank only the sources BM25 actually matched (score > 0); the rest cast no
  // BM25 vote rather than an arbitrary one among ties.
  const matched = sources.map((_, i) => i).filter((i) => bm25[i]! > 0);
  matched.sort((a, b) => bm25[b]! - bm25[a]! || a - b);
  const bm25Rank = new Array<number>(sources.length).fill(0); // 0 = no vote
  matched.forEach((idx, r) => (bm25Rank[idx] = r + 1));

  const raw = sources.map(
    (s, i) => s.rrfScore + (bm25Rank[i] ? bm25Weight * (1 / (RRF_K + bm25Rank[i]!)) : 0),
  );
  const norm = normalize(raw);
  sources.forEach((s, i) => {
    s.bm25Score = bm25[i]!;
    s.relevance = norm[i]!;
  });
  return norm;
}

function similarity(a: MergedSource, aTok: Set<string>, b: MergedSource, bTok: Set<string>): number {
  if (a.domain === b.domain) return SAME_DOMAIN_SIM;
  return jaccard(aTok, bTok);
}

/**
 * Maximal Marginal Relevance reordering.
 *
 *   pick argmax_{d ∉ S} [ λ·Rel(d) − (1−λ)·max_{s ∈ S} Sim(d, s) ],  λ = 1 − diversity
 *
 * Emergent behavior (this is the standard MMR property, and it matches the
 * intuition that a domain's first hit should keep full credit): the highest-
 * relevance result from a domain is picked with no penalty; each *additional*
 * result from that domain carries the redundancy penalty, so other domains
 * out-compete it and get interleaved ahead — a domain's 2nd/3rd hits sink
 * progressively, they are not dropped as a block. O(n²) over a small set.
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
 * The single entry point run() uses: annotate relevance, then order by relevance
 * diversified with MMR (or leave discovery order when rerank is off).
 */
export function orderSources(sources: MergedSource[], query: string, opts: RankOptions): MergedSource[] {
  if (sources.length === 0) return sources;
  const relevance = scoreRelevance(sources, query, opts.bm25Weight);
  if (!opts.rerank) return sources; // annotated, but order preserved
  return mmrOrder(sources, relevance, opts.diversity);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
