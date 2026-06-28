import { tokenize } from './text.js';

/**
 * Okapi BM25 of each document against a query, scored over the result set as the
 * corpus (so IDF reflects *these* results). This is a second relevance signal,
 * independent of Firecrawl's ranking: it scores each result's title+snippet
 * against the user's ORIGINAL query, which re-grounds relevance after probe
 * reformulation — a result that ranked well for the probe "X alternatives" but
 * barely mentions "X" gets a low BM25 against "X".
 *
 * Caveat we don't hide: snippets are short and SEO-shaped, so BM25 here is a
 * useful-but-noisy nudge, not ground truth. That's why it's blended UNDER the
 * rank-fusion signal, not used alone.
 */

const K1 = 1.5; // term-frequency saturation
const B = 0.75; // length normalization

export function bm25Scores(query: string, docs: string[]): number[] {
  const queryTerms = [...new Set(tokenize(query))];
  const docTokens = docs.map(tokenize);
  const N = docTokens.length;
  if (N === 0 || queryTerms.length === 0) return docs.map(() => 0);

  const avgdl = docTokens.reduce((s, d) => s + d.length, 0) / N || 1;

  // document frequency per query term
  const df = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const toks of docTokens) if (toks.includes(term)) count++;
    df.set(term, count);
  }

  const idf = (term: string): number => {
    const n = df.get(term) ?? 0;
    // standard BM25 idf with +1 to keep it non-negative even for common terms
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  return docTokens.map((toks) => {
    const len = toks.length || 1;
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const f = tf.get(term) ?? 0;
      if (f === 0) continue;
      const num = f * (K1 + 1);
      const den = f + K1 * (1 - B + B * (len / avgdl));
      score += idf(term) * (num / den);
    }
    return score;
  });
}
