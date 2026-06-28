'use client';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ChevronDown, Loader2, Search } from 'lucide-react';
import { createRunAction, type RunFormState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const AXES = [
  { key: 'base', label: 'plain search' },
  { key: 'reformulation', label: 'reworded searches' },
  { key: 'source-type', label: 'news / pdf / forums' },
  { key: 'time', label: 'by date' },
  { key: 'region', label: 'by region' },
  { key: 'niche', label: 'specific sites' },
];
const SOURCES = [
  { key: 'web', label: 'web' },
  { key: 'news', label: 'news' },
  { key: 'images', label: 'images' },
];
const CATEGORIES = [
  { key: 'research', label: 'research' },
  { key: 'pdf', label: 'pdf' },
  { key: 'github', label: 'github' },
];
const TIMES = [
  { value: 'any', label: 'Any time' },
  { value: 'qdr:d', label: 'Past day' },
  { value: 'qdr:w', label: 'Past week' },
  { value: 'qdr:m', label: 'Past month' },
  { value: 'qdr:y', label: 'Past year' },
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

function Field({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}

export function NewRunForm({ disabled }: { disabled: boolean }) {
  const [state, action] = useActionState<RunFormState, FormData>(createRunAction, {});
  const [diversity, setDiversity] = useState(0.45);
  const [minRel, setMinRel] = useState(0);
  // Select isn't a native input; mirror its value into a hidden field for FormData.
  const [time, setTime] = useState('any');

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
        Wide fan-out + reranking are on by default. Runs synchronously (~10–30s), then redirects to
        the report.
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
          <Field>
            <Label htmlFor="budget">Probe budget</Label>
            <Input id="budget" name="budget" type="number" min={1} max={60} defaultValue={24} disabled={disabled} />
            <p className="text-muted-foreground text-[11px]">
              How many searches to run. More = wider coverage, more credits.
            </p>
          </Field>
          <Field>
            <Label htmlFor="time">Time range</Label>
            <input type="hidden" name="time" value={time === 'any' ? '' : time} />
            <Select value={time} onValueChange={setTime} disabled={disabled}>
              <SelectTrigger id="time">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <Label htmlFor="maxAge">Max age (days)</Label>
            <Input id="maxAge" name="maxAge" type="number" min={1} placeholder="any" disabled={disabled} />
            <p className="text-muted-foreground text-[11px]">precise freshness; overrides time range</p>
          </Field>

          <Field>
            <Label>Sources</Label>
            <div className="flex flex-wrap gap-3">
              {SOURCES.map((s) => (
                <label key={s.key} className="flex items-center gap-2 text-sm">
                  <Checkbox name={`source:${s.key}`} defaultChecked={s.key !== 'images'} disabled={disabled} />
                  {s.label}
                </label>
              ))}
            </div>
          </Field>
          <Field>
            <Label>Categories</Label>
            <div className="flex flex-wrap gap-3">
              {CATEGORIES.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm">
                  <Checkbox name={`cat:${c.key}`} defaultChecked={c.key !== 'github'} disabled={disabled} />
                  {c.label}
                </label>
              ))}
            </div>
          </Field>

          <Field>
            <Label htmlFor="regions">Regions</Label>
            <Input id="regions" name="regions" placeholder="Germany, Japan, Brazil" disabled={disabled} />
            <p className="text-muted-foreground text-[11px]">comma-separated; blank uses the default sweep</p>
          </Field>
          <Field>
            <Label htmlFor="location">Primary location</Label>
            <Input id="location" name="location" placeholder="e.g. United Kingdom" disabled={disabled} />
          </Field>

          <Field>
            <Label className="flex justify-between">
              <span>Diversity</span>
              <span className="text-muted-foreground font-mono">{diversity.toFixed(2)}</span>
            </Label>
            <Slider name="diversity" min={0} max={1} step={0.05} defaultValue={[0.45]} disabled={disabled}
              onValueChange={(v) => setDiversity(v[0]!)} />
            <p className="text-muted-foreground text-[11px]">0 = pure relevance · 1 = max source spread (MMR)</p>
          </Field>
          <Field>
            <Label className="flex justify-between">
              <span>Min relevance</span>
              <span className="text-muted-foreground font-mono">{minRel.toFixed(2)}</span>
            </Label>
            <Slider name="minRelevance" min={0} max={1} step={0.05} defaultValue={[0]} disabled={disabled}
              onValueChange={(v) => setMinRel(v[0]!)} />
            <p className="text-muted-foreground text-[11px]">drop sub-threshold sources from the result list</p>
          </Field>

          <Field>
            <Label htmlFor="includeDomains">Specific sites</Label>
            <Textarea
              id="includeDomains"
              name="includeDomains"
              rows={2}
              placeholder="tradepub.com, regionalnews.co.uk, forum.example.org"
              disabled={disabled}
            />
            <p className="text-muted-foreground text-[11px]">
              Searched directly — finds sites that don’t show up in normal results.
            </p>
          </Field>
          <Field>
            <Label>Search types</Label>
            <div className="grid grid-cols-2 gap-2">
              {AXES.map((a) => (
                <label key={a.key} className="flex items-center gap-2 text-sm">
                  <Checkbox name={`axis:${a.key}`} defaultChecked disabled={disabled} />
                  {a.label}
                </label>
              ))}
            </div>
          </Field>

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
