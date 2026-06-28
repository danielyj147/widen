import { notFound } from 'next/navigation';
import { ExternalLink, Star } from 'lucide-react';
import type { Probe, Verdict } from '@widen/core';
import { getRun } from '@/lib/runs';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SaturationChart } from './SaturationChart';
import { Timings, type ProbeCall } from './Timings';
import { InfoTip } from '../../InfoTip';

export const dynamic = 'force-dynamic';

const pct = (x: number | null) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);

const verdictClass: Record<Verdict, string> = {
  saturated: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  moderate: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  thin: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
};

function Stat({
  value,
  label,
  sub,
  info,
}: {
  value: React.ReactNode;
  label: string;
  sub?: string;
  info?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
          {label}
          {info && <InfoTip>{info}</InfoTip>}
        </div>
        {sub && <div className="text-muted-foreground/70 text-[11px]">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function LegendSwatch({ kind }: { kind: 'line' | 'bar' | 'dashed' }) {
  if (kind === 'bar') return <span className="bg-muted-foreground/30 inline-block h-3 w-3 rounded-[2px]" />;
  return (
    <svg width="20" height="8" className="inline-block align-middle">
      <line
        x1="0"
        y1="4"
        x2="20"
        y2="4"
        stroke={kind === 'dashed' ? 'var(--muted-foreground)' : 'var(--primary)'}
        strokeWidth="2"
        strokeDasharray={kind === 'dashed' ? '3 3' : undefined}
      />
    </svg>
  );
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();

  const cov = run.coverage;
  const recap = cov.recapture;
  const probeById = new Map<string, Probe>(run.probes.map((p) => [p.id, p]));
  const axisEntries = Object.entries(cov.diversity.byAxis).filter(([, n]) => n > 0);
  const maxAxis = Math.max(1, ...axisEntries.map(([, n]) => n));

  const calls: ProbeCall[] = run.probeResults.map((r) => {
    const p = probeById.get(r.probeId);
    return {
      query: p?.query ?? r.probeId,
      axis: p?.axis ?? '',
      ms: r.ms,
      status: r.status,
      hits: r.results.length,
      attempts: r.attempts,
    };
  });

  return (
    <div className="space-y-5">
      {/* verdict banner */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-lg">“{run.query}”</CardTitle>
            <Badge variant="outline" className={cn('capitalize', verdictClass[cov.verdict])}>
              {cov.verdict}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">{cov.verdictReason}</p>
          <p className="text-muted-foreground text-xs">
            {new Date(run.createdAt).toLocaleString()} · stopped because{' '}
            <span className="font-mono">{stopReasonText(cov.stopReason)}</span> · ~
            {run.estimatedCredits} credits ·{' '}
            {run.config.llm ? 'LLM-enhanced expansion' : 'deterministic expansion'} ·{' '}
            {run.config.rerank
              ? `ranked by relevance + diversity (diversity ${run.config.diversity ?? 0})`
              : 'discovery order'}
            {run.config.maxAgeDays
              ? ` · ≤${run.config.maxAgeDays}d old`
              : run.config.timeRange
                ? ` · time ${run.config.timeRange}`
                : ''}
            {run.config.includeDomains?.length
              ? ` · ${run.config.includeDomains.length} niche domain(s)`
              : ''}
          </p>
          {run.timings && <Timings t={run.timings} calls={calls} />}
        </CardContent>
      </Card>

      {/* headline stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          value={cov.uniqueDomains}
          label="sources"
          sub="distinct websites"
          info={
            <>
              A <b>source</b> is one website / publisher (e.g. <span className="font-mono">nytimes.com</span>).
              Several pages from the same site count once. This is what the customer means by “sources we
              miss”.
            </>
          }
        />
        <Stat value={cov.uniqueUrls} label="pages" sub="distinct result URLs" />
        <Stat
          value={pct(recap.coverage)}
          label="est. coverage"
          sub="of findable sources"
          info={
            <>
              A statistical estimate (<b>capture–recapture / Chao1</b>) of what share of the
              <em> findable</em> sources this run actually found. We infer the total from how often sites
              repeat across search angles: if many sites show up in only one angle, many more likely exist.
              It’s an estimate, not a guarantee — {recap.singletons} of {recap.observedDomains} sources came
              from a single angle here.
            </>
          }
        />
        <Stat
          value={
            <>
              {cov.probesOk}
              <span className="text-muted-foreground text-sm">/{cov.probesIssued}</span>
            </>
          }
          label="searches ok"
          sub={cov.probesFailed > 0 ? `${cov.probesFailed} failed` : 'all succeeded'}
          info={
            <>
              Each <b>search</b> is one Firecrawl <span className="font-mono">/search</span> call from a
              specific angle — a reformulation, a region, a source type, a niche site, etc. widen fans out
              many of them and merges the results. “ok” = the call returned results;
              the rest failed, timed out, were rate-limited, or came back empty.
            </>
          }
        />
      </div>

      {/* saturation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            Are we still finding new sources?
            <InfoTip>
              As each search runs, we track how many <b>new</b> sources it adds. A line that keeps climbing
              means there’s more to find; a flat tail means the search has saturated.
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SaturationChart curve={cov.saturationCurve} estimatedTotal={recap.estimatedTotalDomains} />
          <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            <span className="flex items-center gap-1.5">
              <LegendSwatch kind="line" /> cumulative sources found (running total)
            </span>
            <span className="flex items-center gap-1.5">
              <LegendSwatch kind="bar" /> new sources each search added
            </span>
            <span className="flex items-center gap-1.5">
              <LegendSwatch kind="dashed" /> estimated total findable (~{recap.estimatedTotalDomains})
            </span>
          </div>
          <p className="text-muted-foreground/80 mt-2 text-[11px]">{recap.caveat}</p>
        </CardContent>
      </Card>

      {/* where coverage came from */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            Which search angles found sources
            <InfoTip>
              Distinct sources contributed by each kind of search. Shows where the long tail actually came
              from — e.g. regional or niche angles, not the base query.
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {axisEntries.map(([axis, nSources]) => (
            <div key={axis} className="flex items-center gap-3 text-sm">
              <span className="w-32 flex-none font-mono text-xs">{axisLabel(axis)}</span>
              <div className="bg-muted h-2 flex-1 overflow-hidden rounded">
                <div className="bg-primary h-full rounded" style={{ width: `${(nSources / maxAxis) * 100}%` }} />
              </div>
              <span className="text-muted-foreground w-24 flex-none text-right font-mono text-xs">
                {nSources} sources
              </span>
            </div>
          ))}
          <Separator className="my-1" />
          <p className="text-muted-foreground text-xs">
            Top 5 sites hold {pct(cov.diversity.top5DomainShare)} of all results ·{' '}
            {Object.entries(cov.diversity.bySource).map(([s, c]) => `${c} ${s}`).join(' · ')}
          </p>
        </CardContent>
      </Card>

      {/* failures */}
      {cov.failures.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader>
            <CardTitle className="text-sm text-amber-400">Failed searches ({cov.failures.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>status</TableHead>
                  <TableHead>search</TableHead>
                  <TableHead>error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cov.failures.map((f, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Badge variant="outline" className={verdictClass.thin}>{f.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {probeById.get(f.probeId)?.query ?? f.probeId}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{f.error}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* results */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            Results ({run.sources.length} pages)
            <InfoTip>
              Every distinct page found, deduped across all searches and ordered by relevance + diversity. A
              <Star className="mx-1 inline size-3 fill-amber-400 text-amber-400" /> marks a page found by only
              one search angle — usually the long-tail sources that a single search misses.
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6" />
                <TableHead>site</TableHead>
                <TableHead>page</TableHead>
                <TableHead className="w-44">found by</TableHead>
                <TableHead className="w-16">type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.sources.map((s) => {
                const axes = [
                  ...new Set(s.foundByProbes.map((p) => probeById.get(p)?.axis).filter(Boolean)),
                ];
                return (
                  <TableRow key={s.url}>
                    <TableCell>
                      {s.foundByProbes.length === 1 && (
                        <Star className="size-3 fill-amber-400 text-amber-400" />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.domain}</TableCell>
                    <TableCell>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary inline-flex items-center gap-1 hover:underline"
                      >
                        <span className="line-clamp-1">{s.title || s.url}</span>
                        <ExternalLink className="size-3 flex-none opacity-60" />
                      </a>
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.foundByProbes.length} search{s.foundByProbes.length === 1 ? '' : 'es'}
                      <span className="text-muted-foreground"> · {axes.map((a) => axisLabel(String(a))).join(', ')}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">{s.source}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function axisLabel(axis: string): string {
  const map: Record<string, string> = {
    base: 'base query',
    reformulation: 'reformulation',
    'source-type': 'source type',
    time: 'time window',
    region: 'region',
    niche: 'niche domain',
  };
  return map[axis] ?? axis;
}

function stopReasonText(r: string): string {
  const map: Record<string, string> = {
    saturated: 'saturated (no new sources)',
    'budget-exhausted': 'hit the probe budget',
    'probes-exhausted': 'ran every search angle',
  };
  return map[r] ?? r;
}
