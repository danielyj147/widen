import type { RunArtifact, RunSummary } from '@widen/core';
import { c, pct, sparkline, verdictBadge } from './ui.js';

const RULE = c.gray('─'.repeat(64));

/** The headline report after a run: the verdict, the numbers, and the honesty. */
export function renderArtifact(a: RunArtifact): string {
  const cov = a.coverage;
  const L: string[] = [];
  L.push('');
  L.push(c.bold(`  "${a.query}"`));
  L.push(RULE);

  // verdict + the one-line reason — the most important thing on screen
  L.push(`  ${verdictBadge(cov.verdict)}   ${c.dim(cov.verdictReason)}`);
  L.push('');

  // the numbers
  const recap = cov.recapture;
  L.push(
    `  ${c.bold(String(cov.uniqueUrls))} sources across ${c.bold(String(cov.uniqueDomains))} domains` +
      `   ${c.dim(`from ${cov.probesIssued} probes, ${cov.totalRawResults} raw results`)}`,
  );
  if (recap.coverage != null) {
    L.push(
      `  estimated coverage ${c.bold(pct(recap.coverage))} ` +
        c.dim(`(~${recap.estimatedTotalDomains} domains discoverable; ${recap.singletons} found by a single probe)`),
    );
  } else {
    L.push(c.dim('  coverage estimate unavailable (too few sources)'));
  }

  // saturation sparkline
  const newPerProbe = cov.saturationCurve.map((p) => p.newDomains);
  L.push(`  saturation   ${c.cyan(sparkline(newPerProbe))}  ${c.dim('(new domains per probe; flat tail = saturated)')}`);
  L.push(`  stopped on   ${c.dim(cov.stopReason)}   est. credits ${c.dim(String(a.estimatedCredits))}`);
  L.push('');

  // where the long tail came from — the whole point of the tool
  L.push(c.bold('  domains found per axis'));
  for (const [axis, n] of Object.entries(cov.diversity.byAxis)) {
    if (n === 0) continue;
    L.push(`    ${axis.padEnd(14)} ${c.cyan(bar(n, cov.uniqueDomains))} ${n}`);
  }
  L.push(`  ${c.dim(`top-5 domains hold ${pct(cov.diversity.top5DomainShare)} of sources`)}`);

  // failures, surfaced not swallowed
  if (cov.probesFailed > 0) {
    L.push('');
    L.push(c.yellow(`  ⚠ ${cov.probesFailed} of ${cov.probesIssued} probes failed:`));
    for (const f of cov.failures.slice(0, 5)) {
      L.push(c.dim(`    ${f.status}: ${f.error ?? ''}`.slice(0, 70)));
    }
  }

  // a peek at the sources — lead with the ones only the wide search found
  L.push('');
  L.push(c.bold('  sample sources ') + c.dim('(★ = found by only one probe — likely long-tail)'));
  for (const s of a.sources.slice(0, 12)) {
    const star = s.foundByProbes.length === 1 ? c.yellow('★') : ' ';
    L.push(`  ${star} ${c.cyan(s.domain.padEnd(24).slice(0, 24))} ${c.dim(s.title.slice(0, 48))}`);
  }
  if (a.sources.length > 12) L.push(c.dim(`    … and ${a.sources.length - 12} more (see the dashboard, or --json)`));
  L.push('');
  return L.join('\n') + '\n';
}

function bar(n: number, total: number): string {
  const width = total > 0 ? Math.round((n / total) * 20) : 0;
  return '▇'.repeat(Math.max(0, Math.min(20, width)));
}

/** A compact table for `list` / batch summaries. Accepts artifacts or summaries. */
export function renderRunList(runs: Array<RunArtifact | RunSummary>): string {
  const rows = runs.map((r) => ('coverage' in r ? toSummary(r) : r));
  const L: string[] = [];
  L.push(
    c.dim('  verdict     domains  cov%   probes  query'),
  );
  for (const r of rows) {
    const v =
      r.verdict === 'saturated' ? c.green('saturated') : r.verdict === 'moderate' ? c.yellow('moderate ') : c.red('thin     ');
    const failMark = r.probesFailed > 0 ? c.yellow(`!${r.probesFailed}`) : '  ';
    L.push(
      `  ${v}  ${String(r.uniqueDomains).padStart(7)}  ${pct(r.coveragePct).padStart(4)}  ${String(r.probesIssued).padStart(4)}${failMark}  ${r.query.slice(0, 40)}`,
    );
  }
  return L.join('\n');
}

function toSummary(a: RunArtifact): RunSummary {
  return {
    id: a.id,
    query: a.query,
    createdAt: a.createdAt,
    verdict: a.coverage.verdict,
    uniqueDomains: a.coverage.uniqueDomains,
    uniqueUrls: a.coverage.uniqueUrls,
    probesIssued: a.coverage.probesIssued,
    probesFailed: a.coverage.probesFailed,
    coveragePct: a.coverage.recapture.coverage,
  };
}
