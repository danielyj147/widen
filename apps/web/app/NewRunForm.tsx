'use client';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ChevronDown, Loader2, Search } from 'lucide-react';
import { createRunAction, type RunFormState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const AXES: Array<{ key: string; label: string }> = [
  { key: 'base', label: 'base query' },
  { key: 'reformulation', label: 'reformulations' },
  { key: 'source-type', label: 'source types (news · pdf · research · forums)' },
  { key: 'time', label: 'time windows' },
  { key: 'region', label: 'regional sweep' },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="px-5">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
      {pending ? 'Running fan-out…' : 'Search'}
    </Button>
  );
}

export function NewRunForm({ disabled }: { disabled: boolean }) {
  const [state, action] = useActionState<RunFormState, FormData>(createRunAction, {});
  const [diversity, setDiversity] = useState(0.45);
  const [minRel, setMinRel] = useState(0);

  return (
    <form action={action} className="space-y-3">
      <div className="flex gap-2">
        <Input
          name="query"
          placeholder='e.g. "solid state battery suppliers"'
          className="h-11 text-[15px]"
          required
          disabled={disabled}
          autoFocus
        />
        <SubmitButton />
      </div>
      <p className="text-muted-foreground text-xs">
        Runs synchronously — a 24-probe fan-out takes ~10–30s, then redirects to the report.
      </p>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-sm"
          >
            <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
            Advanced options
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="bg-card mt-3 grid gap-5 rounded-lg border p-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="budget">Probe budget</Label>
            <Input id="budget" name="budget" type="number" min={1} max={60} defaultValue={24} disabled={disabled} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Location bias (optional)</Label>
            <Input id="location" name="location" placeholder="e.g. Germany" disabled={disabled} />
          </div>

          <div className="space-y-2">
            <Label className="flex justify-between">
              <span>Diversity</span>
              <span className="text-muted-foreground font-mono">{diversity.toFixed(2)}</span>
            </Label>
            <Slider name="diversity" min={0} max={1} step={0.05} defaultValue={[0.45]} disabled={disabled}
              onValueChange={(v) => setDiversity(v[0]!)} />
            <p className="text-muted-foreground text-[11px]">0 = pure relevance · 1 = max source spread (MMR)</p>
          </div>
          <div className="space-y-2">
            <Label className="flex justify-between">
              <span>Min relevance</span>
              <span className="text-muted-foreground font-mono">{minRel.toFixed(2)}</span>
            </Label>
            <Slider name="minRelevance" min={0} max={1} step={0.05} defaultValue={[0]} disabled={disabled}
              onValueChange={(v) => setMinRel(v[0]!)} />
            <p className="text-muted-foreground text-[11px]">drop sub-threshold sources from the result list</p>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>Search strategies</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {AXES.map((a) => (
                <label key={a.key} className="flex items-center gap-2 text-sm">
                  <Checkbox name={`axis:${a.key}`} defaultChecked disabled={disabled} />
                  {a.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="rerank" name="rerank" defaultChecked disabled={disabled} />
            <Label htmlFor="rerank" className="font-normal">Rerank (RRF + BM25, MMR)</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="llm" name="llm" disabled={disabled} />
            <Label htmlFor="llm" className="font-normal">LLM-enhanced expansion</Label>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {state.error && (
        <p className="text-destructive border-destructive/40 bg-destructive/10 rounded-md border px-3 py-2 text-sm">
          {state.error}
        </p>
      )}
    </form>
  );
}
