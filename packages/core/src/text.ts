/**
 * Minimal text utilities shared by the BM25 relevance signal and the MMR
 * similarity function. Deliberately tiny and dependency-free: lowercase,
 * split on non-alphanumerics, drop a short stoplist and 1-char tokens.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at',
  'by', 'is', 'are', 'be', 'as', 'it', 'this', 'that', 'from', 'how', 'what',
  'your', 'you', 'we', 'our',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Jaccard overlap of two token multisets treated as sets. Range [0,1]. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Min-max normalize to [0,1]; returns all-zeros if the values are constant. */
export function normalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max - min === 0) return values.map(() => 0);
  return values.map((v) => (v - min) / (max - min));
}
