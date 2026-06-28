/**
 * Shared vocabulary for the whole engine.
 *
 * The pipeline is: query -> Probe[] (expand) -> ProbeResult[] (fan-out) ->
 * MergedSource[] (merge/dedup) -> CoverageReport -> RunArtifact.
 */

/** The axis a probe explores. Each axis surfaces a *different slice* of the index. */
export type ProbeAxis =
  | 'base' // the user's query, untouched — our honest baseline
  | 'reformulation' // synonyms / facets / question forms / entity pivots
  | 'source-type' // forums, trade press, news, pdf/research/github categories
  | 'time' // tbs windows — pull older and fresher long-tail
  | 'region'; // location sweeps — regional press

/** A subset of Firecrawl /search params we vary per probe. */
export interface ProbeParams {
  limit?: number;
  sources?: Array<'web' | 'news' | 'images'>;
  categories?: Array<'github' | 'research' | 'pdf'>;
  tbs?: string;
  location?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
}

/** One search we will issue. Deterministic id so runs are reproducible/cacheable. */
export interface Probe {
  id: string;
  query: string;
  axis: ProbeAxis;
  params: ProbeParams;
  /** Human-readable reason this probe exists — shown in the dashboard. */
  rationale: string;
}

/** A single raw hit from Firecrawl, normalized across web/news sources. */
export interface RawResult {
  url: string;
  title: string;
  snippet: string;
  /** 'web' | 'news' — which Firecrawl source returned it. */
  source: 'web' | 'news';
  /** Rank within that probe's result list (1-based), if known. */
  position?: number;
}

export type ProbeStatus = 'ok' | 'empty' | 'timeout' | 'rate-limited' | 'error';

/** The outcome of issuing one probe. Failures are first-class, never swallowed. */
export interface ProbeResult {
  probeId: string;
  status: ProbeStatus;
  results: RawResult[];
  /** Present when status is not ok/empty. */
  error?: string;
  ms: number;
  attempts: number;
}

/** A de-duplicated source, with provenance back to the probes that found it. */
export interface MergedSource {
  url: string;
  domain: string;
  title: string;
  snippet: string;
  /** ids of every probe that surfaced this source — the basis for recapture math. */
  foundByProbes: string[];
  /** Best (lowest) rank this source achieved in any single probe. */
  bestPosition: number;
  /**
   * Reciprocal Rank Fusion score: sum over the probes that found this source of
   * 1/(RRF_K + rank). Rewards good ranks and corroboration across probes, while
   * still scoring a source that ranked highly in a single niche probe — so the
   * long tail is ordered fairly, not buried. Always computed; only used for
   * ordering when reranking is on.
   */
  rrfScore: number;
  /** BM25 of title+snippet vs the original query (raw; 0 until ranking runs). */
  bm25Score: number;
  /** Blended relevance in [0,1] (normalized RRF + BM25). Set by ranking. */
  relevance: number;
  source: 'web' | 'news';
}

/** Estimated total richness via Chao1, plus the inputs so it's auditable. */
export interface RecaptureEstimate {
  observedDomains: number;
  /** domains found by exactly one probe. */
  singletons: number;
  /** domains found by exactly two probes. */
  doubletons: number;
  estimatedTotalDomains: number;
  /** observed / estimated, clamped to [0,1]. null when not estimable. */
  coverage: number | null;
  method: 'chao1' | 'chao1-bias-corrected' | 'insufficient-data';
  caveat: string;
}

export interface SaturationPoint {
  probeIndex: number; // 1-based, in execution order
  probeId: string;
  cumulativeUrls: number;
  cumulativeDomains: number;
  newDomains: number; // domains this probe added that no earlier probe had
}

export type Verdict = 'thin' | 'moderate' | 'saturated';
export type StopReason = 'saturated' | 'budget-exhausted' | 'probes-exhausted';

export interface CoverageReport {
  probesIssued: number;
  probesOk: number;
  probesFailed: number;
  totalRawResults: number;
  uniqueUrls: number;
  uniqueDomains: number;
  saturationCurve: SaturationPoint[];
  recapture: RecaptureEstimate;
  diversity: {
    /** share of sources concentrated in the top-5 domains (0..1). */
    top5DomainShare: number;
    /** count of sources by Firecrawl source. */
    bySource: Record<string, number>;
    /** count of distinct domains per probe axis. */
    byAxis: Record<ProbeAxis, number>;
  };
  stopReason: StopReason;
  verdict: Verdict;
  /** Why we landed on this verdict — shown verbatim to the user. */
  verdictReason: string;
  failures: Array<{ probeId: string; status: ProbeStatus; error?: string }>;
}

export interface RunConfig {
  budget: number; // max probes
  concurrency: number;
  perProbeLimit: number;
  maxRetries: number;
  perProbeTimeoutMs: number;
  llm: boolean;
  /** order the merged sources by relevance + MMR diversity (default true). */
  rerank: boolean;
  /** MMR diversity in [0,1]: 0 = pure relevance, 1 = max source spread. */
  diversity: number;
  /** adaptive stop: min new domains a wave must add to keep going. */
  saturationMinNewDomains: number;
  /** adaptive stop: consecutive low-yield waves tolerated before stopping. */
  saturationPatience: number;
  axes: ProbeAxis[];
  location?: string;
}

export interface RunArtifact {
  schemaVersion: 1;
  id: string;
  query: string;
  createdAt: string;
  finishedAt: string;
  durationMs: number;
  config: RunConfig;
  probes: Probe[];
  probeResults: ProbeResult[];
  sources: MergedSource[];
  coverage: CoverageReport;
  /** estimated Firecrawl credits spent (1 search ≈ 1 credit + scrape costs; we don't scrape). */
  estimatedCredits: number;
}
