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
 * Chao1 richness estimator (Chao, 1984), the standard lower-bound estimate of
 * how many *unseen* classes a sampling effort missed. Here a "class" is a domain
 * and a "sample" is a probe: a domain found by only one probe (a singleton) is
 * evidence that more such domains exist but were not hit. If many domains are
 * singletons, we have almost certainly missed others, and coverage is low.
 *
 *   estimated total = observed + f1^2 / (2 * f2)
 *
 * where f1 = domains seen by exactly one probe, f2 = by exactly two. When f2 = 0
 * we use the bias-corrected form. This is an estimate, not a guarantee, and it
 * assumes probes sample somewhat independently — we say so in the caveat.
 */
export function chao1(domainIncidence: number[]): RecaptureEstimate {
  const observed = domainIncidence.length;
  const f1 = domainIncidence.filter((n) => n === 1).length;
  const f2 = domainIncidence.filter((n) => n === 2).length;

  if (observed === 0) {
    return {
      observedDomains: 0,
      singletons: 0,
      doubletons: 0,
      estimatedTotalDomains: 0,
      coverage: null,
      method: 'insufficient-data',
      caveat: 'No sources were found, so coverage cannot be estimated.',
    };
  }

  let estimatedTotal: number;
  let method: RecaptureEstimate['method'];
  if (f2 > 0) {
    estimatedTotal = observed + (f1 * f1) / (2 * f2);
    method = 'chao1';
  } else {
    // bias-corrected form, valid when there are no doubletons.
    estimatedTotal = observed + (f1 * (f1 - 1)) / 2;
    method = 'chao1-bias-corrected';
  }

  const coverage = estimatedTotal > 0 ? Math.min(1, observed / estimatedTotal) : null;
  return {
    observedDomains: observed,
    singletons: f1,
    doubletons: f2,
    estimatedTotalDomains: Math.round(estimatedTotal),
    coverage,
    method,
    caveat:
      'A statistical estimate (it assumes the different search angles find sites ' +
      'somewhat independently). Many sites turning up in only one angle is strong ' +
      'evidence that more remain unfound.',
  };
}

/** Per-domain incidence = number of distinct probes that surfaced that domain. */
export function domainIncidence(sources: MergedSource[]): number[] {
  const probesByDomain = new Map<string, Set<string>>();
  for (const s of sources) {
    const set = probesByDomain.get(s.domain) ?? new Set<string>();
    for (const p of s.foundByProbes) set.add(p);
    probesByDomain.set(s.domain, set);
  }
  return [...probesByDomain.values()].map((s) => s.size);
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
      reason: `The last ${tail.length} searches barely turned up new sites, and we estimate this run found about ${pct(cov)} of the sites worth finding. More searching is unlikely to surface much.`,
    };
  }
  if ((cov != null && cov < 0.5) || !tailFlat) {
    return {
      verdict: 'thin',
      reason:
        cov != null && cov < 0.5
          ? `We estimate this run found only about ${pct(cov)} of the sites worth finding — ${recapture.singletons} of ${recapture.observedDomains} sites turned up in just one search angle, a sign many more exist. Coverage is likely incomplete.`
          : 'New sites were still appearing in the final searches — coverage had not leveled off when the run stopped.',
    };
  }
  return {
    verdict: 'moderate',
    reason: `We estimate about ${cov != null ? pct(cov) : 'n/a'} coverage of the sites worth finding: results are leveling off, but some long-tail sources may remain.`,
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
  const recapture = chao1(domainIncidence(sources));
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
