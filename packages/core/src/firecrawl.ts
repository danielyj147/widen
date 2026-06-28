import { Firecrawl } from 'firecrawl';
import type { Probe, ProbeResult, ProbeStatus, RawResult } from './types.js';

/**
 * The only thing the engine needs from Firecrawl. Defining it as an interface
 * lets the whole pipeline be tested deterministically against a fake, with no
 * network and no credits spent.
 */
export interface SearchClient {
  run(probe: Probe, opts: SearchRunOpts): Promise<ProbeResult>;
}

export interface SearchRunOpts {
  maxRetries: number;
  timeoutMs: number;
  /** injectable for tests; defaults to real timers. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Reject with a timeout error if `p` doesn't settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`client timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Classify an error into a ProbeStatus so the UI can show *why* a probe failed. */
export function classifyError(err: unknown): { status: ProbeStatus; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('aborted') || lower.includes('timeout') || lower.includes('timed out')) {
    return { status: 'timeout', message: msg };
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many')) {
    return { status: 'rate-limited', message: msg };
  }
  return { status: 'error', message: msg };
}

function isRetryable(status: ProbeStatus): boolean {
  return status === 'rate-limited' || status === 'timeout' || status === 'error';
}

/** Normalize Firecrawl's web/news arrays into our flat RawResult shape. */
export function normalizeResults(data: unknown): RawResult[] {
  const out: RawResult[] = [];
  const d = data as { web?: unknown[]; news?: unknown[] } | null | undefined;
  if (!d) return out;
  const web = Array.isArray(d.web) ? d.web : [];
  web.forEach((item, i) => {
    const r = item as { url?: string; title?: string; description?: string };
    if (!r?.url) return; // scraped Documents without a url are skipped
    out.push({
      url: r.url,
      title: r.title ?? '',
      snippet: r.description ?? '',
      source: 'web',
      position: i + 1,
    });
  });
  const news = Array.isArray(d.news) ? d.news : [];
  news.forEach((item, i) => {
    const r = item as { url?: string; title?: string; snippet?: string; position?: number };
    if (!r?.url) return;
    out.push({
      url: r.url,
      title: r.title ?? '',
      snippet: r.snippet ?? '',
      source: 'news',
      position: r.position ?? i + 1,
    });
  });
  return out;
}

/**
 * Run one probe with retries + exponential backoff + per-attempt timeout.
 * `searchFn` is the raw call; isolating it keeps retry logic testable.
 */
export async function runProbeWith(
  probe: Probe,
  searchFn: (probe: Probe, timeoutMs: number) => Promise<unknown>,
  opts: SearchRunOpts,
): Promise<ProbeResult> {
  const sleep = opts.sleep ?? defaultSleep;
  const started = Date.now();
  let attempts = 0;
  let lastErr: { status: ProbeStatus; message: string } | null = null;

  while (attempts < opts.maxRetries) {
    attempts++;
    try {
      const data = await searchFn(probe, opts.timeoutMs);
      const results = normalizeResults(data);
      return {
        probeId: probe.id,
        status: results.length === 0 ? 'empty' : 'ok',
        results,
        ms: Date.now() - started,
        attempts,
      };
    } catch (err) {
      lastErr = classifyError(err);
      if (!isRetryable(lastErr.status) || attempts >= opts.maxRetries) break;
      // backoff: 500ms, 1s, 2s ... with light jitter to avoid thundering herd.
      const backoff = 500 * 2 ** (attempts - 1) + Math.floor(Math.random() * 250);
      await sleep(backoff);
    }
  }

  return {
    probeId: probe.id,
    status: lastErr?.status ?? 'error',
    results: [],
    error: lastErr?.message ?? 'unknown error',
    ms: Date.now() - started,
    attempts,
  };
}

/** Real Firecrawl-backed client. */
export class FirecrawlSearchClient implements SearchClient {
  private fc: Firecrawl;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error('FIRECRAWL_API_KEY is required');
    this.fc = new Firecrawl({ apiKey });
  }

  run(probe: Probe, opts: SearchRunOpts): Promise<ProbeResult> {
    return runProbeWith(
      probe,
      async (p, timeoutMs) => {
        // Pass `timeout` so Firecrawl bounds the search server-side, AND race the
        // promise client-side so a hung socket can't outlive the per-probe budget.
        const call = this.fc.search(p.query, {
          sources: p.params.sources,
          categories: p.params.categories,
          includeDomains: p.params.includeDomains,
          excludeDomains: p.params.excludeDomains,
          limit: p.params.limit,
          tbs: p.params.tbs,
          location: p.params.location,
          timeout: timeoutMs,
        });
        return await withTimeout(call, timeoutMs);
      },
      opts,
    );
  }
}
