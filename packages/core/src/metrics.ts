/**
 * Ranking-quality metrics. Used by the offline ranking evaluation to compare
 * ordering strategies against graded relevance judgments.
 */

/** Discounted Cumulative Gain at k. gains are graded relevances in rank order. */
export function dcgAt(gains: number[], k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, gains.length); i++) {
    // standard log2(i+2) discount (rank i is 0-based)
    dcg += (2 ** gains[i]! - 1) / Math.log2(i + 2);
  }
  return dcg;
}

/**
 * Normalized DCG at k: DCG of the produced order divided by DCG of the ideal
 * order (relevances sorted descending). Range [0,1]; 1 means the ranking placed
 * the most relevant items first. Returns 0 when there is no relevance to gain.
 */
export function ndcgAt(orderedGains: number[], k: number): number {
  const ideal = [...orderedGains].sort((a, b) => b - a);
  const idcg = dcgAt(ideal, k);
  if (idcg === 0) return 0;
  return dcgAt(orderedGains, k) / idcg;
}
