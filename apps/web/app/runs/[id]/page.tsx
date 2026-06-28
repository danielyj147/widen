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
  info,
  valueClass,
}: {
  value: React.ReactNode;
  label: string;
  info?: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className={cn('text-2xl font-semibold tracking-tight', valueClass)}>{value}</div>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
          {label}
          {info && <InfoTip>{info}</InfoTip>}
        </div>
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
          <p className="text-muted-foreground text-xs">
            {new Date(run.createdAt).toLocaleString()} · {stopReasonText(cov.stopReason)} · ~
            {run.estimatedCredits} credits
            {run.config.maxAgeDays
              ? ` · ≤${run.config.maxAgeDays}d old`
              : run.config.timeRange
                ? ` · ${run.config.timeRange}`
                : ''}
            {run.config.includeDomains?.length
              ? ` · ${run.config.includeDomains.length} specific site(s)`
              : ''}
          </p>
          {run.timings && <Timings t={run.timings} calls={calls} />}
        </CardContent>
      </Card>

      {/* headline numbers */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          value={cov.uniqueDomains}
          label="websites"
          info={
            <>
              Distinct websites found (e.g. <span className="font-mono">nytimes.com</span>). Several pages
              from the same website count once.
            </>
          }
        />
        <Stat
          value={cov.uniqueUrls}
          label="pages"
          info="Distinct links found, across every search."
        />
        <Stat
          value={pct(recap.coverage)}
          valueClass={coverageColor(recap.coverage)}
          label="coverage"
          info={
            <>
              Our best guess at the share of findable websites this run actually found.{' '}
              <b>How we guess:</b> if many websites show up in just one of our searches, there are likely
              many more we haven’t hit yet — the way spotting lots of one-off animals while sampling a
              forest means more species are out there. We turn that overlap into an estimate (a standard
              method called capture–recapture). It’s a guess, not a guarantee.
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
          info={
            <>
              Each search is one query sent to Firecrawl with a twist — a reworded version, a region, a
              site type, a specific website. We run many and combine the results. “ok” = the search came
              back with results; the rest failed, timed out, or were empty.
            </>
          }
        />
      </div>

      {/* saturation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            Still finding new websites?
            <InfoTip>
              Each search adds some <b>new</b> websites. A line that keeps climbing means there’s more to
              find; a line that flattens means we’ve likely found most of them.
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SaturationChart curve={cov.saturationCurve} estimatedTotal={recap.estimatedTotalDomains} />
          <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            <span className="flex items-center gap-1.5">
              <LegendSwatch kind="line" /> websites found so far
            </span>
            <span className="flex items-center gap-1.5">
              <LegendSwatch kind="bar" /> new websites per search
            </span>
            <span className="flex items-center gap-1.5">
              <LegendSwatch kind="dashed" /> estimated total out there (~{recap.estimatedTotalDomains})
            </span>
          </div>
        </CardContent>
      </Card>

      {/* where results came from */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            Where the results came from
            <InfoTip>
              How many websites each kind of search contributed. Shows whether the extras came from
              rewordings, regions, or specific sites — not just the plain query.
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {axisEntries.map(([axis, nSites]) => (
            <div key={axis} className="flex items-center gap-3 text-sm">
              <span className="w-32 flex-none text-xs">{axisLabel(axis)}</span>
              <div className="bg-muted h-2 flex-1 overflow-hidden rounded">
                <div className="bg-primary h-full rounded" style={{ width: `${(nSites / maxAxis) * 100}%` }} />
              </div>
              <span className="text-muted-foreground w-24 flex-none text-right font-mono text-xs">
                {nSites} sites
              </span>
            </div>
          ))}
          <Separator className="my-1" />
          <p className="text-muted-foreground text-xs">
            Top 5 websites hold {pct(cov.diversity.top5DomainShare)} of all results.
          </p>
        </CardContent>
      </Card>

      {/* failures */}
      {cov.failures.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader>
            <CardTitle className="text-sm text-amber-400">Searches that failed ({cov.failures.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>what happened</TableHead>
                  <TableHead>search</TableHead>
                  <TableHead>detail</TableHead>
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
            Results ({run.sources.length})
            <InfoTip>
              Every page found, with duplicates removed and ordered best-first. A
              <Star className="mx-1 inline size-3 fill-amber-400 text-amber-400" /> means only one search
              found it — usually the hard-to-find pages a single search misses.
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6" />
                <TableHead>website</TableHead>
                <TableHead>page</TableHead>
                <TableHead className="w-24">
                  <span className="inline-flex items-center gap-1">
                    match
                    <InfoTip>
                      How well the page matches your query, relative to the others in this run (green =
                      strong, red = weak). Used to order the list.
                    </InfoTip>
                  </span>
                </TableHead>
                <TableHead className="w-28">found by</TableHead>
                <TableHead className="w-16">type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.sources.map((s) => (
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
                  <TableCell>
                    <div className="bg-muted h-1.5 w-16 overflow-hidden rounded" title={`relevance ${s.relevance.toFixed(2)}`}>
                      <div
                        className={cn('h-full rounded', relevanceColor(s.relevance))}
                        style={{ width: `${Math.max(4, s.relevance * 100)}%` }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {s.foundByProbes.length} search{s.foundByProbes.length === 1 ? '' : 'es'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal">{s.source}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/** Color the coverage figure by how complete it is — green/amber/red at a glance. */
function coverageColor(cov: number | null): string {
  if (cov == null) return '';
  if (cov >= 0.8) return 'text-emerald-400';
  if (cov >= 0.5) return 'text-amber-400';
  return 'text-rose-400';
}

/** Color a relevance score (0..1, relative to this run) green/amber/red. */
function relevanceColor(r: number): string {
  if (r >= 0.66) return 'bg-emerald-500';
  if (r >= 0.33) return 'bg-amber-500';
  return 'bg-rose-500';
}

/** Plain-English name for each kind of search. */
function axisLabel(axis: string): string {
  const map: Record<string, string> = {
    base: 'plain search',
    reformulation: 'reworded search',
    'source-type': 'news / pdf / forums',
    time: 'by date',
    region: 'by region',
    niche: 'specific sites',
  };
  return map[axis] ?? axis;
}

function stopReasonText(r: string): string {
  const map: Record<string, string> = {
    saturated: 'stopped — no new websites',
    'budget-exhausted': 'stopped — hit the search limit',
    'probes-exhausted': 'stopped — ran every search',
  };
  return map[r] ?? r;
}
