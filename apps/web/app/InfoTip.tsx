'use client';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** A small "?" icon that explains a term on hover/focus — keeps the report
 *  legible to first-time users without cluttering it with prose. */
export function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground/70 hover:text-foreground align-middle">
          <Info className="size-3.5" />
          <span className="sr-only">more info</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-[12px] leading-snug">{children}</TooltipContent>
    </Tooltip>
  );
}
