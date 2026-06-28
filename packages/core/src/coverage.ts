import type {
  CoverageReport,
  MergedSource,
  Probe,
  ProbeAxis,
  ProbeResult,
  RecaptureEstimate,
  RunConfig,
  SaturationPoint,
  StopReason,
  Verdict,
} from './types.js';

/**
 * Lincoln–Petersen capture–recapture estimator (Chapman-corrected, 1951) — the
 * classic two-sample method for estimating an unseen population.
 *
 *   N̂ = (n1 + 1)(n2 + 1) / (m + 1) − 1
 *
 * where n1 = websites caught by sample 1, n2 = by sample 2, m = caught by both.
 * Intuition: if the two independent searches share *few* websites (small m
 * relative to n1·n2), the pool must be large and we've seen little of it; if they
 * share *most* of what they found, we've likely seen it all. Chapman's +1s remove
 * the small-sample bias and keep it defined at m = 0.
 *
 * The two samples must be reasonably independent. We use the *original-query*
 * searches (varied settings) as sample 1 and the *expanded-query* searches as
 * sample 2 — different query words give the most independence. Returned
 * separately so callers can decide; pass observed = |sample1 ∪ sample2|.
 */
export function lincolnPetersen(
  n1: number,
  n2: number,
  overlap: number,
  observed: number,
): RecaptureEstimate {
  if (observed === 0) {
    return blankEstimate(0, 0, 0, 'No websites were found, so coverage cannot be estimated.');
  }
  if (n1 === 0 || n2 === 0) {
    return blankEstimate(
      n1,
      n2,
      overlap,
      'Coverage needs two independent searches to estimate, and this run had only one kind. Enable query expansion or vary the settings to get an estimate.',
      observed,
    );
  }
  const est = ((n1 + 1) * (n2 + 1)) / (overlap + 1) - 1;
  const coverage = est > 0 ? Math.min(1, observed / est) : null;
  return {
    observedDomains: observed,
    sample1: n1,
    sample2: n2,
    overlap,
    estimatedTotalDomains: Math.round(est),
    coverage,
    method: 'lincoln-petersen',
    caveat:
      'A two-sample capture–recapture estimate (Lincoln–Petersen). Sample 1 = ' +
      'websites from the original-query searches, sample 2 = from the expanded/' +
      'varied searches. The fewer the two share, the more we estimate remain ' +
      'unfound. It assumes the two samples find websites somewhat independently.',
  };
}

function blankEstimate(
  n1: number,
  n2: number,
  overlap: number,
  caveat: string,
  observed = 0,
): RecaptureEstimate {
  return {
    observedDomains: observed,
    sample1: n1,
    sample2: n2,
    overlap,
    estimatedTotalDomains: observed,
    coverage: null,
    method: 'insufficient-data',
    caveat,
  };
}

/**
 * Partition the found websites into the two capture-recapture samples by whether
 * the probe that found them used the original query (sample 1: same query, varied
 * settings) or an expanded query (sample 2). Returns {n1, n2, overlap, observed}.
 */
export function partitionSamples(
  sources: MergedSource[],
  probeById: Map<string, Probe>,
  originalQuery: string,
): { n1: number; n2: number; overlap: number; observed: number } {
  const orig = originalQuery.trim().toLowerCase();
  const s1 = new Set<string>();
  const s2 = new Set<string>();
  for (const s of sources) {
    for (const pid of s.foundByProbes) {
      const expanded = (probeById.get(pid)?.query ?? orig).trim().toLowerCase() !== orig;
      (expanded ? s2 : s1).add(s.domain);
    }
  }
  let overlap = 0;
  for (const d of s1) if (s2.has(d)) overlap++;
  return { n1: s1.size, n2: s2.size, overlap, observed: new Set([...s1, ...s2]).size };
}

/** Cumulative unique URLs/domains in execution order — the saturation curve. */
export function saturationCurve(
  orderedProbeIds: string[],
  sourcesByProbe: Map<string, MergedSource[]>,
): SaturationPoint[] {
  const seenUrls = new Set<string>();
  const seenDomains = new Set<string>();
  const curve: SaturationPoint[] = [];
  orderedProbeIds.forEach((probeId, i) => {
    let newDomains = 0;
    for (const s of sourcesByProbe.get(probeId) ?? []) {
      seenUrls.add(s.url);
      if (!seenDomains.has(s.domain)) {
        seenDomains.add(s.domain);
        newDomains++;
      }
    }
    curve.push({
      probeIndex: i + 1,
      probeId,
      cumulativeUrls: seenUrls.size,
      cumulativeDomains: seenDomains.size,
      newDomains,
    });
  });
  return curve;
}

function decideVerdict(
  curve: SaturationPoint[],
  recapture: RecaptureEstimate,
  cfg: RunConfig,
): { verdict: Verdict; reason: string } {
  if (curve.length === 0 || recapture.observedDomains === 0) {
    return { verdict: 'thin', reason: 'No sources were found.' };
  }
  const tail = curve.slice(-cfg.saturationPatience);
  const tailFlat =
    tail.length >= cfg.saturationPatience &&
    tail.every((p) => p.newDomains < cfg.saturationMinNewDomains);
  const cov = recapture.coverage;

  if (cov != null && cov >= 0.8 && tailFlat) {
    return {
      verdict: 'saturated',
      reason: `The last ${tail.length} searches barely turned up new websites, and we estimate this run found about ${pct(cov)} of the websites out there. More searching probably won't add much.`,
    };
  }
  if ((cov != null && cov < 0.5) || !tailFlat) {
    return {
      verdict: 'thin',
      reason:
        cov != null && cov < 0.5
          ? `We estimate this run found only about ${pct(cov)} of the websites out there — the original and expanded searches shared just ${recapture.overlap} of ${recapture.observedDomains} websites, a sign many more exist. Likely incomplete.`
          : 'New websites were still showing up in the final searches — the run stopped before results leveled off.',
    };
  }
  return {
    verdict: 'moderate',
    reason: `About ${cov != null ? pct(cov) : 'n/a'} estimated coverage: results are leveling off, but some hard-to-find websites may remain.`,
  };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function buildCoverage(
  probes: Probe[],
  probeResults: ProbeResult[],
  sources: MergedSource[],
  cfg: RunConfig,
  stopReason: StopReason,
  query: string,
): CoverageReport {
  const probeById = new Map(probes.map((p) => [p.id, p]));
  const orderedIds = probeResults.map((r) => r.probeId);

  // group sources by the probes that found them, for the curve
  const sourcesByProbe = new Map<string, MergedSource[]>();
  for (const s of sources) {
    for (const pid of s.foundByProbes) {
      const arr = sourcesByProbe.get(pid) ?? [];
      arr.push(s);
      sourcesByProbe.set(pid, arr);
    }
  }

  const curve = saturationCurve(orderedIds, sourcesByProbe);
  const { n1, n2, overlap, observed } = partitionSamples(sources, probeById, query);
  const recapture = lincolnPetersen(n1, n2, overlap, observed);
  const { verdict, reason } = decideVerdict(curve, recapture, cfg);

  // diversity
  const domainCounts = new Map<string, number>();
  const bySource: Record<string, number> = {};
  for (const s of sources) {
    domainCounts.set(s.domain, (domainCounts.get(s.domain) ?? 0) + 1);
    bySource[s.source] = (bySource[s.source] ?? 0) + 1;
  }
  const top5 = [...domainCounts.values()].sort((a, b) => b - a).slice(0, 5);
  const top5DomainShare = sources.length ? top5.reduce((a, b) => a + b, 0) / sources.length : 0;

  const byAxis = emptyAxisCounts();
  const domainsByAxis = new Map<ProbeAxis, Set<string>>();
  for (const s of sources) {
    for (const pid of s.foundByProbes) {
      const axis = probeById.get(pid)?.axis;
      if (!axis) continue;
      const set = domainsByAxis.get(axis) ?? new Set<string>();
      set.add(s.domain);
      domainsByAxis.set(axis, set);
    }
  }
  for (const [axis, set] of domainsByAxis) byAxis[axis] = set.size;

  const failures = probeResults
    .filter((r) => r.status !== 'ok' && r.status !== 'empty')
    .map((r) => ({ probeId: r.probeId, status: r.status, error: r.error }));

  return {
    probesIssued: probeResults.length,
    probesOk: probeResults.filter((r) => r.status === 'ok' || r.status === 'empty').length,
    probesFailed: failures.length,
    totalRawResults: probeResults.reduce((a, r) => a + r.results.length, 0),
    uniqueUrls: sources.length,
    uniqueDomains: domainCounts.size,
    saturationCurve: curve,
    recapture,
    diversity: { top5DomainShare, bySource, byAxis },
    stopReason,
    verdict,
    verdictReason: reason,
    failures,
  };
}

function emptyAxisCounts(): Record<ProbeAxis, number> {
  return { base: 0, reformulation: 0, 'source-type': 0, time: 0, region: 0, niche: 0 };
}
