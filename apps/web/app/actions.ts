'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ProbeAxis } from '@widen/core';
import { createRun } from '../lib/runs';

export interface RunFormState {
  error?: string;
}

/** Server action for the ad-hoc "new run" form. Runs the engine, then redirects. */
export async function createRunAction(
  _prev: RunFormState,
  formData: FormData,
): Promise<RunFormState> {
  const query = String(formData.get('query') ?? '').trim();
  if (!query) return { error: 'Enter a query.' };

  const budget = clampInt(formData.get('budget'), 24, 1, 60);
  const llm = formData.get('llm') === 'on';
  const location = String(formData.get('location') ?? '').trim() || undefined;

  let id: string;
  try {
    const artifact = await createRun(query, {
      budget,
      llm,
      location,
      axes: ['base', 'reformulation', 'source-type', 'time', 'region'] as ProbeAxis[],
    });
    id = artifact.id;
  } catch (err) {
    return { error: (err as Error).message };
  }
  revalidatePath('/');
  redirect(`/runs/${id}`);
}

function clampInt(v: FormDataEntryValue | null, def: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
