import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunArtifact } from './types.js';

/**
 * Run artifacts are just JSON files on disk in a runs/ directory. No database:
 * the data is small, append-only, and naturally one-file-per-run. The CLI writes
 * them; the dashboard reads them. (Prisma <-> Studio, minus the database.)
 */

export interface RunSummary {
  id: string;
  query: string;
  createdAt: string;
  verdict: RunArtifact['coverage']['verdict'];
  uniqueDomains: number;
  uniqueUrls: number;
  probesIssued: number;
  probesFailed: number;
  coveragePct: number | null;
}

export function summarize(run: RunArtifact): RunSummary {
  return {
    id: run.id,
    query: run.query,
    createdAt: run.createdAt,
    verdict: run.coverage.verdict,
    uniqueDomains: run.coverage.uniqueDomains,
    uniqueUrls: run.coverage.uniqueUrls,
    probesIssued: run.coverage.probesIssued,
    probesFailed: run.coverage.probesFailed,
    coveragePct: run.coverage.recapture.coverage,
  };
}

export async function saveRun(dir: string, run: RunArtifact): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${run.id}.json`);
  await writeFile(path, JSON.stringify(run, null, 2), 'utf8');
  return path;
}

export async function loadRun(dir: string, id: string): Promise<RunArtifact> {
  const raw = await readFile(join(dir, `${id}.json`), 'utf8');
  return JSON.parse(raw) as RunArtifact;
}

/** List run summaries, newest first. Tolerates a missing dir and skips bad files. */
export async function listRuns(dir: string): Promise<RunSummary[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const summaries: RunSummary[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(dir, f), 'utf8');
      summaries.push(summarize(JSON.parse(raw) as RunArtifact));
    } catch {
      // skip corrupt/partial files rather than failing the whole listing
    }
  }
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
