'use client';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { RunSummary } from '@widen/core';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

const dotColor: Record<RunSummary['verdict'], string> = {
  saturated: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  thin: 'bg-rose-500',
};

/** Chat-style history rail: a "new search" action + scrollable list of past runs. */
export function Sidebar({ runs }: { runs: RunSummary[] }) {
  const pathname = usePathname();
  return (
    <aside className="bg-sidebar text-sidebar-foreground sticky top-0 flex h-screen w-72 flex-none flex-col border-r">
      <div className="border-b px-4 py-4">
        <a href="/" className="text-[15px] font-semibold tracking-tight">
          <span className="text-primary">widen</span>{' '}
          <span className="text-muted-foreground font-normal">· search coverage</span>
        </a>
      </div>
      <div className="p-3">
        <Button asChild variant={pathname === '/' ? 'default' : 'outline'} className="w-full justify-start">
          <a href="/">
            <Plus className="size-4" /> New search
          </a>
        </Button>
      </div>
      <ScrollArea className="flex-1 px-2 pb-4">
        {runs.length === 0 ? (
          <p className="text-muted-foreground px-2 py-2 text-xs">No runs yet. Start one above.</p>
        ) : (
          <ul className="space-y-0.5">
            {runs.map((r) => {
              const active = pathname === `/runs/${r.id}`;
              return (
                <li key={r.id}>
                  <a
                    href={`/runs/${r.id}`}
                    className={cn(
                      'block rounded-md px-2.5 py-2 hover:bg-muted',
                      active && 'bg-muted ring-primary/60 shadow-[inset_2px_0_0] shadow-primary',
                    )}
                  >
                    <div className="truncate text-[13px]">{r.query}</div>
                    <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[11px]">
                      <span className={cn('size-1.5 rounded-full', dotColor[r.verdict])} />
                      {r.uniqueDomains} domains
                      {r.probesFailed > 0 && <span className="text-amber-500">· !{r.probesFailed}</span>}
                      <span className="ml-auto">{new Date(r.createdAt).toLocaleDateString()}</span>
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </aside>
  );
}
