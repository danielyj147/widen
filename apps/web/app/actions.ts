'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type RunConfig } from '@widen/core';
import { createRun } from '@/lib/runs';

export interface RunFormState {
  error?: string;
}

/** Server action for the new-search form. Runs the engine, then redirects. */
export async function createRunAction(
  _prev: RunFormState,
  formData: FormData,
): Promise<RunFormState> {
  const query = String(formData.get('query') ?? '').trim();
  if (!query) return { error: 'Enter a query.' };

  const cfg: Partial<RunConfig> = {
    budget: clampInt(formData.get('budget'), 24, 1, 60),
    diversity: clampUnit(formData.get('diversity'), 0.45),
    minRelevance: clampUnit(formData.get('minRelevance'), 0),
    freshnessWeight: clampWeight(formData.get('freshness')),
    authorityWeight: clampWeight(formData.get('authority')),
    llm: formData.get('llm') === 'on',
    // rerank checkbox defaults checked; absent => opted out.
    rerank: formData.get('rerank') === 'on',
  };
  const location = String(formData.get('location') ?? '').trim();
  if (location) cfg.location = location;

  // "Also search" verticals — web is always on; news is a source, the rest are
  // categories. (Search-type axes are implicit — they self-gate on these fields.)
  cfg.sources = formData.get('vertical:news') === 'on' ? ['web', 'news'] : ['web'];
  cfg.categories = (['research', 'pdf', 'github'] as const).filter(
    (c) => formData.get(`vertical:${c}`) === 'on',
  );

  // regions (comma) and niche include-domains (comma or newline)
  const regions = splitList(String(formData.get('regions') ?? ''));
  if (regions.length) cfg.regions = regions;
  cfg.includeDomains = splitList(String(formData.get('includeDomains') ?? ''));

  const time = String(formData.get('time') ?? '').trim();
  if (time) cfg.timeRange = time; // already a tbs value from the <Select>
  const maxAge = Number(formData.get('maxAge'));
  if (Number.isFinite(maxAge) && maxAge > 0) cfg.maxAgeDays = Math.round(maxAge);

  let id: string;
  try {
    const artifact = await createRun(query, cfg);
    id = artifact.id;
  } catch (err) {
    return { error: (err as Error).message };
  }
  revalidatePath('/', 'layout'); // refresh the sidebar history
  redirect(`/runs/${id}`);
}

function clampInt(v: FormDataEntryValue | null, def: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function clampUnit(v: FormDataEntryValue | null, def: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.min(1, n));
}

function clampWeight(v: FormDataEntryValue | null): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(5, n);
}

/** split a comma- or newline-separated list into trimmed, non-empty entries. */
function splitList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
