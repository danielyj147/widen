'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ALL_AXES, type ProbeAxis, type RunConfig } from '@widen/core';
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
    llm: formData.get('llm') === 'on',
    // rerank checkbox defaults checked; absent => opted out.
    rerank: formData.get('rerank') === 'on',
  };
  const location = String(formData.get('location') ?? '').trim();
  if (location) cfg.location = location;

  // axes checkboxes (each named axis:<name>); fall back to all if none chosen.
  const axes = ALL_AXES.filter((a) => formData.get(`axis:${a}`) === 'on');
  cfg.axes = axes.length ? (axes as ProbeAxis[]) : ALL_AXES;

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
