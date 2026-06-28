/**
 * Eval harness: the verifiable claim behind this whole tool.
 *
 * For each topic we run TWO searches with the SAME credit-ish budget framing:
 *   - baseline: one Firecrawl /search at limit 50 (what the customer does today)
 *   - widen:    the full fan-out
 * and report how many domains widen surfaced that the deep single ranking never
 * did. "Going from 10 to 50 gave 40 more of the same" — this measures whether
 * widening actually breaks that.
 *
 * Usage: npm run eval -- [topicsFile] [--baseline-limit 50] [--budget 24]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  FirecrawlSearchClient,
  readLlmEnv,
  run,
  type RunArtifact,
  type RunConfig,
} from '@widen/core';
import { c, pct } from './ui.js';

const DEFAULT_TOPICS = [
  'solid state battery suppliers',
  'enterprise data observability vendors',
  'regional craft cidery trends',
];

interface TopicEval {
  topic: string;
  baselineDomains: number;
  widenDomains: number;
  newDomains: number; // in widen, not in baseline
  overlap: number;
  liftPct: number; // newDomains / baselineDomains
  widenCoverageEst: number | null;
  widenVerdict: RunArtifact['coverage']['verdict'];
}

function domains(a: RunArtifact): Set<string> {
  return new Set(a.sources.map((s) => s.domain));
}

async function evalTopic(
  topic: string,
  client: FirecrawlSearchClient,
  baselineLimit: number,
  budget: number,
): Promise<TopicEval> {
  // baseline: exactly what the customer runs — one ranking, read deep.
  const baseline = await run(topic, {
    client,
    config: { axes: ['base'], budget: 1, perProbeLimit: baselineLimit, llm: false },
  });
  // widen: the full fan-out.
  const wide = await run(topic, {
    client,
    config: { budget, llm: false } as Partial<RunConfig>,
    llmEnv: readLlmEnv(),
  });

  const b = domains(baseline);
  const w = domains(wide);
  const newOnes = [...w].filter((d) => !b.has(d));
  const overlap = [...w].filter((d) => b.has(d)).length;
  return {
    topic,
    baselineDomains: b.size,
    widenDomains: w.size,
    newDomains: newOnes.length,
    overlap,
    liftPct: b.size ? newOnes.length / b.size : 0,
    widenCoverageEst: wide.coverage.recapture.coverage,
    widenVerdict: wide.coverage.verdict,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const topicsFile = args.find((a) => !a.startsWith('--'));
  const baselineLimit = Number(flag(args, '--baseline-limit') ?? 50);
  const budget = Number(flag(args, '--budget') ?? 24);

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    console.error(c.red('FIRECRAWL_API_KEY is not set.'));
    process.exit(1);
  }
  const topics = topicsFile
    ? (await readFile(resolve(process.cwd(), topicsFile), 'utf8'))
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    : DEFAULT_TOPICS;

  const client = new FirecrawlSearchClient(apiKey);
  console.error(c.bold(`eval: ${topics.length} topics — baseline limit ${baselineLimit} vs widen budget ${budget}\n`));

  const results: TopicEval[] = [];
  for (const t of topics) {
    process.stderr.write(c.dim(`  running "${t}" … `));
    try {
      const r = await evalTopic(t, client, baselineLimit, budget);
      results.push(r);
      console.error(c.green(`+${r.newDomains} new domains (${pct(r.liftPct)} lift)`));
    } catch (err) {
      console.error(c.red(`failed: ${(err as Error).message}`));
    }
  }

  // table
  console.log('\n' + c.bold('  topic                              baseline  widen   new   lift'));
  for (const r of results) {
    console.log(
      `  ${r.topic.slice(0, 32).padEnd(34)} ${String(r.baselineDomains).padStart(8)} ${String(r.widenDomains).padStart(6)} ${c.green(String(r.newDomains).padStart(5))} ${c.cyan(pct(r.liftPct).padStart(6))}`,
    );
  }
  if (results.length) {
    const avgLift = results.reduce((a, r) => a + r.liftPct, 0) / results.length;
    const totalNew = results.reduce((a, r) => a + r.newDomains, 0);
    console.log(c.bold(`\n  ${totalNew} net-new domains across ${results.length} topics; average lift ${pct(avgLift)} over baseline limit ${baselineLimit}.`));
  }

  const outPath = resolve(process.cwd(), 'runs', `eval-${Date.now()}.json`);
  await writeFile(outPath, JSON.stringify({ baselineLimit, budget, results }, null, 2), 'utf8');
  console.error(c.dim(`\nwrote ${outPath}`));
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

main().catch((err) => {
  console.error(c.red('fatal: ') + (err as Error).message);
  process.exit(1);
});
