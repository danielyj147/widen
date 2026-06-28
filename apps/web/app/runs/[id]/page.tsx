import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, Star } from 'lucide-react';
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

export const dynamic = 'force-dynamic';

const pct = (x: number | null) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);

const verdictClass: Record<Verdict, string> = {
  saturated: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  moderate: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  thin: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
};

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <div className="text-muted-foreground mt-0.5 text-xs">{label}</div>
      </CardContent>
    </Card>
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
      <a href="/" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-3.5" /> all runs
      </a>

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
            {new Date(run.createdAt).toLocaleString()} · stopped on{' '}
            <span className="font-mono">{cov.stopReason}</span> · ~{run.estimatedCredits} credits ·{' '}
            {run.config.llm ? 'LLM-enhanced expansion' : 'deterministic expansion'} ·{' '}
            {run.config.rerank
              ? `ranked: RRF + BM25, MMR diversity ${run.config.diversity ?? 0}`
              : 'discovery order'}
          </p>
          {run.timings && <Timings t={run.timings} calls={calls} />}
        </CardContent>
      </Card>

      {/* headline stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat value={cov.uniqueDomains} label="unique domains" />
        <Stat value={cov.uniqueUrls} label="unique sources" />
        <Stat value={pct(recap.coverage)} label="est. coverage (Chao1)" />
        <Stat
          value={
            <>
              {cov.probesOk}
              <span className="text-muted-foreground text-sm">/{cov.probesIssued}</span>
            </>
          }
          label={`probes ok${cov.probesFailed > 0 ? ` · ${cov.probesFailed} failed` : ''}`}
        />
      </div>

      {/* saturation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Saturation</CardTitle>
        </CardHeader>
        <CardContent>
          <SaturationChart curve={cov.saturationCurve} estimatedTotal={recap.estimatedTotalDomains} />
          <p className="text-muted-foreground mt-2 text-xs">
            Line = cumulative domains found. Bars = new domains each probe added. Dashed = Chao1 estimate
            of total discoverable domains ({recap.singletons} found by a single probe, {recap.doubletons} by
            two). {recap.caveat}
          </p>
        </CardContent>
      </Card>

      {/* where coverage came from */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Where coverage came from</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {axisEntries.map(([axis, nDomains]) => (
            <div key={axis} className="flex items-center gap-3 text-sm">
              <span className="w-32 font-mono text-xs">{axis}</span>
              <div className="bg-muted h-2 flex-1 overflow-hidden rounded">
                <div className="bg-primary h-full rounded" style={{ width: `${(nDomains / maxAxis) * 100}%` }} />
              </div>
              <span className="text-muted-foreground w-20 text-right font-mono text-xs">{nDomains} dom.</span>
            </div>
          ))}
          <Separator className="my-1" />
          <p className="text-muted-foreground text-xs">
            Top-5 domains hold {pct(cov.diversity.top5DomainShare)} of sources ·{' '}
            {Object.entries(cov.diversity.bySource).map(([s, c]) => `${c} ${s}`).join(' · ')}
          </p>
        </CardContent>
      </Card>

      {/* failures */}
      {cov.failures.length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader>
            <CardTitle className="text-sm text-amber-400">Failed probes ({cov.failures.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>status</TableHead>
                  <TableHead>probe</TableHead>
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

      {/* sources */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Sources ({run.sources.length}){' '}
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-normal">
              <Star className="size-3 fill-amber-400 text-amber-400" /> found by only one probe (long-tail)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6" />
                <TableHead>domain</TableHead>
                <TableHead>title</TableHead>
                <TableHead className="w-40">found by</TableHead>
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
                      {s.foundByProbes.length}
                      <span className="text-muted-foreground"> · {axes.join(', ')}</span>
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
