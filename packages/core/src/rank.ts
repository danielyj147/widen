import { bm25Scores } from './bm25.js';
import { RRF_K } from './merge.js';
import { normalize, tokenize } from './text.js';
import { cosine, tfidfVectors } from './tfidf.js';
import type { MergedSource } from './types.js';

/**
 * How many "votes" the BM25 ranked list gets in the fusion, in units of probe
 * lists. Every probe (keyword query) counts as 1; BM25 — the only signal tied to
 * the user's ORIGINAL query rather than a reformulation — gets more.
 *
 * Chosen by offline evaluation, not guessed: `npm run eval:rank` with a
 * claude-opus-4-8 judge (nDCG@10) showed the fusion improving monotonically with
 * BM25 weight and beating both RRF-only and Firecrawl's own order —
 * rrf+bm25@12 0.802 > @8 0.782 > rrf_only 0.730 > baseline 0.649. 12 is the
 * evaluated winner (returns flatten past ~8). Exposed as an argument so the eval
 * harness can re-sweep it.
 */
export const DEFAULT_BM25_WEIGHT = 12;

export interface RankOptions {
  /** false => leave discovery order untouched (still annotate relevance). */
  rerank: boolean;
  /** MMR diversity in [0,1]: 0 = pure relevance, 1 = max diversity. */
  diversity: number;
  /** drop sources whose normalized relevance is below this (0 = keep all). */
  minRelevance?: number;
  /** override BM25 fusion weight (evaluation only). */
  bm25Weight?: number;
}

/**
 * Relevance via a SINGLE Reciprocal Rank Fusion over every ranked list we have:
 * one per probe (already summed into `s.rrfScore` during merge), plus one from
 * BM25 of title+snippet vs the ORIGINAL query. BM25 is itself a ranking, so it
 * joins the fusion as another list rather than being score-blended — RRF needs
 * only ranks. The fused score is min-max normalized to [0,1] so it's comparable
 * to the cosine similarity term in MMR. Writes bm25Score/relevance onto sources.
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
  const matched = sources.map((_, i) => i).filter((i) => bm25[i]! > 0);
  matched.sort((a, b) => bm25[b]! - bm25[a]! || a - b);
  const bm25Rank = new Array<number>(sources.length).fill(0);
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

/**
 * Maximal Marginal Relevance reordering — the standard form:
 *
 *   pick argmax_{d ∉ S} [ λ·Rel(d) − (1−λ)·max_{s ∈ S} cosTfIdf(d, s) ],  λ = 1 − diversity
 *
 * Similarity is cosine over tf-idf vectors of title+snippet (Carbonell &
 * Goldstein 1998) — no domain heuristics, no tuned constants. The first/best
 * item from a redundant cluster keeps full credit; later near-duplicates are
 * demoted and out-competed by less-similar items. O(n²) over a small set.
 */
export function mmrOrder(sources: MergedSource[], relevance: number[], diversity: number): MergedSource[] {
  const lambda = 1 - clamp01(diversity);
  const vecs = tfidfVectors(sources.map((s) => tokenize(`${s.title} ${s.snippet}`)));
  const remaining = sources.map((_, i) => i);
  const selected: number[] = [];
  const marginal: number[] = []; // the MMR score each pick won with (non-increasing)

  while (remaining.length > 0) {
    let bestPos = 0;
    let bestScore = -Infinity;
    for (let r = 0; r < remaining.length; r++) {
      const i = remaining[r]!;
      let maxSim = 0;
      for (const j of selected) {
        const sim = cosine(vecs[i]!, vecs[j]!);
        if (sim > maxSim) maxSim = sim;
      }
      const score = lambda * relevance[i]! - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestPos = r;
      }
    }
    selected.push(remaining[bestPos]!);
    marginal.push(bestScore);
    remaining.splice(bestPos, 1);
  }

  // The marginal is provably non-increasing in pick order, so normalizing it
  // gives a per-item rank score consistent with the displayed order.
  const norm = normalize(marginal);
  selected.forEach((i, k) => (sources[i]!.rankScore = norm[k]!));
  return selected.map((i) => sources[i]!);
}

/**
 * Entry point run() uses: annotate relevance, drop sources below `minRelevance`,
 * then order by relevance diversified with MMR (or keep discovery order when
 * rerank is off). Relevance/bm25 are annotated either way for transparency.
 */
export function orderSources(sources: MergedSource[], query: string, opts: RankOptions): MergedSource[] {
  if (sources.length === 0) return sources;
  scoreRelevance(sources, query, opts.bm25Weight);

  const min = opts.minRelevance ?? 0;
  const kept = min > 0 ? sources.filter((s) => s.relevance >= min) : sources;

  if (!opts.rerank) {
    // discovery order: no diversity step, so the rank score is just relevance.
    kept.forEach((s) => (s.rankScore = s.relevance));
    return kept;
  }
  const relevance = kept.map((s) => s.relevance);
  return mmrOrder(kept, relevance, opts.diversity);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
