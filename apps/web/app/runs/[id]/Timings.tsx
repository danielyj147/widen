'use client';
import { useState } from 'react';
import { ChevronDown, Clock } from 'lucide-react';
import type { ProbeStatus, RunTimings } from '@widen/core';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);

export interface ProbeCall {
  query: string;
  axis: string;
  ms: number;
  status: ProbeStatus;
  hits: number;
  attempts: number;
}

const statusColor: Record<ProbeStatus, string> = {
  ok: 'text-emerald-400',
  empty: 'text-muted-foreground',
  'rate-limited': 'text-amber-400',
  timeout: 'text-amber-400',
  error: 'text-rose-400',
};

/**
 * Per-phase timing, hidden behind a disclosure — observability for clients who
 * want to see where the latency budget went, without cluttering the report.
 * Fan-out (network) dominates; local steps including BM25 + tf-idf MMR are tiny.
 */
export function Timings({ t, calls }: { t: RunTimings; calls: ProbeCall[] }) {
  const [open, setOpen] = useState(false);
  if (!t) return null;
  const slowest = [...calls].sort((a, b) => b.ms - a.ms);
  const maxCall = Math.max(1, ...calls.map((c) => c.ms));

  const phases: Array<{ label: string; ms: number; note?: string }> = [
    { label: 'expand', ms: t.expandMs, note: 'build the search angles (local)' },
    {
      label: 'Firecrawl calls',
      ms: t.fanoutMs,
      note: `the /search network calls · p50 ${ms(t.probeMsP50)} / slowest ${ms(t.probeMsMax)}`,
    },
    { label: 'merge + dedup', ms: t.mergeMs, note: 'combine results, drop duplicates (local)' },
    { label: 'coverage', ms: t.coverageMs, note: 'capture-recapture estimate + saturation (local)' },
    { label: 'rank', ms: t.rankMs, note: 'RRF + BM25 + tf-idf MMR (local)' },
  ];
  const max = Math.max(1, ...phases.map((p) => p.ms));

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground group flex items-center gap-1.5 text-xs"
        >
          <Clock className="size-3.5" />
          Timing
          <span className="font-mono">{ms(t.totalMs)}</span>
          <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="mt-2">
          <CardContent className="space-y-2 py-4">
            {phases.map((p) => (
              <div key={p.label} className="flex items-center gap-3 text-xs">
                <span className="w-28 flex-none font-mono">{p.label}</span>
                <div className="bg-muted h-2 w-40 flex-none overflow-hidden rounded">
                  <div className="bg-primary/70 h-full rounded" style={{ width: `${(p.ms / max) * 100}%` }} />
                </div>
                <span className="w-16 flex-none text-right font-mono">{ms(p.ms)}</span>
                <span className="text-muted-foreground hidden flex-1 truncate sm:block">{p.note ?? ''}</span>
              </div>
            ))}
            <p className="text-muted-foreground pt-1 text-[11px]">
              Wall-clock per phase. The <span className="font-mono">Firecrawl calls</span> row is the
              network time (the actual <span className="font-mono">/search</span> requests); everything
              else runs locally in single-digit-to-tens of ms.
            </p>

            {/* per-Firecrawl-call timing — one /search call per probe */}
            <div className="border-t pt-3">
              <p className="text-muted-foreground mb-2 text-[11px]">
                Each Firecrawl <span className="font-mono">/search</span> call ({calls.length}),
                slowest first:
              </p>
              <ScrollArea className="h-56 pr-2">
                <div className="space-y-1">
                  {slowest.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span className={cn('w-20 flex-none font-mono', statusColor[c.status])}>
                        {c.status}
                      </span>
                      <div className="bg-muted h-1.5 w-24 flex-none overflow-hidden rounded">
                        <div className="bg-primary/70 h-full rounded" style={{ width: `${(c.ms / maxCall) * 100}%` }} />
                      </div>
                      <span className="w-14 flex-none text-right font-mono">{ms(c.ms)}</span>
                      <span className="text-muted-foreground w-10 flex-none text-right">{c.hits} hits</span>
                      {c.attempts > 1 && <span className="text-amber-400 flex-none">×{c.attempts}</span>}
                      <span className="truncate">
                        <span className="text-muted-foreground">{c.axis}</span> {c.query}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}
