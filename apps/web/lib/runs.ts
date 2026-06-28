import 'server-only';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FirecrawlSearchClient,
  listRuns,
  loadRun,
  readLlmEnv,
  run as runEngine,
  saveRun,
  type RunArtifact,
  type RunConfig,
} from '@widen/core';

/**
 * Where run artifacts live. `next dev` runs with cwd = apps/web, so the repo
 * root runs/ is two levels up. Overridable for other layouts.
 */
export const RUNS_DIR = process.env.WIDEN_RUNS_DIR
  ? resolve(process.env.WIDEN_RUNS_DIR)
  : resolve(process.cwd(), '../../runs');

/**
 * The CLI loads the repo-root .env via `node --env-file`. Next only auto-loads
 * .env from the app dir, so we mirror the single-key UX by reading the root .env
 * once if the key isn't already in the environment. Minimal parser; no dep.
 */
let envLoaded = false;
function ensureRootEnv() {
  if (envLoaded) return;
  envLoaded = true;
  if (process.env.FIRECRAWL_API_KEY) return;
  try {
    const text = readFileSync(resolve(process.cwd(), '../../.env'), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]!]) {
        process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // no root .env — the UI will surface the missing-key state.
  }
}

export function hasApiKey(): boolean {
  ensureRootEnv();
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

export async function getRuns() {
  return listRuns(RUNS_DIR);
}

export async function getRun(id: string): Promise<RunArtifact | null> {
  try {
    return await loadRun(RUNS_DIR, id);
  } catch {
    return null;
  }
}

/** Run the engine ad hoc from the dashboard and persist the artifact. */
export async function createRun(
  query: string,
  config: Partial<RunConfig>,
): Promise<RunArtifact> {
  ensureRootEnv();
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set');
  const client = new FirecrawlSearchClient(apiKey);
  const artifact = await runEngine(query, { client, config, llmEnv: readLlmEnv() });
  await saveRun(RUNS_DIR, artifact);
  return artifact;
}
