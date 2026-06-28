import { tokenize } from './text.js';

/**
 * TF-IDF vectors + cosine similarity — the standard document-similarity used in
 * Maximal Marginal Relevance (Carbonell & Goldstein, 1998). Each document
 * (title+snippet) becomes an L2-normalized sparse term vector weighted by
 * tf * idf; similarity is the dot product (= cosine, since vectors are unit
 * length). No tuned constants, no domain special-casing.
 */

export type SparseVec = Map<string, number>;

/** Build L2-normalized tf-idf vectors for a corpus of token lists. */
export function tfidfVectors(docsTokens: string[][]): SparseVec[] {
  const N = docsTokens.length;
  const df = new Map<string, number>();
  for (const toks of docsTokens) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return docsTokens.map((toks) => {
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec: SparseVec = new Map();
    let norm = 0;
    for (const [t, f] of tf) {
      // smoothed idf, always positive
      const idf = Math.log((N + 1) / ((df.get(t) ?? 0) + 1)) + 1;
      const w = f * idf;
      vec.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of vec) vec.set(t, w / norm);
    return vec;
  });
}

/** Cosine similarity of two L2-normalized sparse vectors (their dot product). */
export function cosine(a: SparseVec, b: SparseVec): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const w2 = large.get(t);
    if (w2) dot += w * w2;
  }
  return dot;
}

export { tokenize };
