/**
 * URL canonicalization for dedup. Conservative on purpose: we only strip things
 * that are virtually always noise (tracking params, fragments, trailing slash,
 * default ports, leading www). We do NOT collapse different paths or query
 * params that might be meaningful — over-merging hides real sources, which is
 * the opposite of what this product is for.
 */

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'igshid',
  '_hsenc',
  '_hsmi',
]);

export function canonicalizeUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return input.trim();
  }
  u.protocol = u.protocol === 'http:' ? 'https:' : u.protocol;
  u.hostname = u.hostname.replace(/^www\./i, '').toLowerCase();
  u.hash = '';
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) {
    u.port = '';
  }
  for (const p of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(p.toLowerCase())) u.searchParams.delete(p);
  }
  // sort remaining params so order-only differences merge
  u.searchParams.sort();
  // drop a trailing slash on non-root paths so "/a/" and "/a" merge
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }
  return u.toString();
}

/** Registrable-ish domain. Not a full PSL — good enough for diversity counts. */
export function domainOf(input: string): string {
  let host: string;
  try {
    host = new URL(input).hostname;
  } catch {
    return input;
  }
  host = host.replace(/^www\./i, '').toLowerCase();
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  // handle common two-label public suffixes (co.uk, com.au, ...)
  const twoLabelSuffixes = new Set([
    'co.uk',
    'com.au',
    'co.jp',
    'co.kr',
    'com.br',
    'co.in',
    'com.mx',
    'co.za',
    'com.tr',
    'com.cn',
  ]);
  const lastTwo = parts.slice(-2).join('.');
  if (twoLabelSuffixes.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}
