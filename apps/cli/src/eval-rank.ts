/**
 * Ranking evaluation — the data behind the ranking defaults.
 *
 * For each query: fetch the merged pool (rerank off), have an LLM judge grade
 * every pooled result's relevance (0–3) to the ORIGINAL query, then score
 * several ordering strategies by nDCG@10:
 *   - baseline   : Firecrawl-style order (best single-probe rank)
 *   - bm25_only  : BM25 alone
 *   - rrf+bm25@w : the fusion at BM25 weight w (w=0 is RRF over probes only)
 *
 * The winning w is what DEFAULT_BM25_WEIGHT should be. This is how we replace a
 * magic number with a measured one. LLM-judge grades are a noisy proxy (esp. a
 * small local model), so treat small gaps as ties — the harness prints the judge
 * model so the numbers are reproducible/contestable.
 *
 * Usage: npm run eval:rank -- [topicsFile] [--budget 16] [--pool 50]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  FirecrawlSearchClient,
  judgeRelevance,
  ndcgAt,
  readLlmEnv,
  RRF_K,
  run,
  type MergedSource,
} from '@widen/core';
import { c } from './ui.js';

const DEFAULT_TOPICS = [
  'solid state battery suppliers',
  'wireless earbuds for small ears',
  'enterprise data observability vendors',
];

const WEIGHTS = [0, 1, 3, 5, 8, 12]; // BM25 fusion weights to sweep (0 = RRF only)

/** BM25 rank (1-based) for sources with a positive BM25 score; 0 = no vote. */
function bm25Ranks(sources: MergedSource[]): number[] {
  const idx = sources.map((_, i) => i).filter((i) => sources[i]!.bm25Score > 0);
  idx.sort((a, b) => sources[b]!.bm25Score - sources[a]!.bm25Score || a - b);
  const ranks = new Array<number>(sources.length).fill(0);
  idx.forEach((s, r) => (ranks[s] = r + 1));
  return ranks;
}

function fusedScore(s: MergedSource, bm25Rank: number, w: number): number {
  return s.rrfScore + (bm25Rank ? w * (1 / (RRF_K + bm25Rank)) : 0);
}

function orderBy(sources: MergedSource[], score: (s: MergedSource, i: number) => number): MergedSource[] {
  return sources.map((_, i) => i).sort((a, b) => score(sources[b]!, b) - score(sources[a]!, a)).map((i) => sources[i]!);
}

interface Strategy {
  name: string;
  order: (sources: MergedSource[], ranks: number[]) => MergedSource[];
}

function strategies(): Strategy[] {
  const list: Strategy[] = [
    { name: 'baseline', order: (s) => orderBy(s, (x) => -x.bestPosition) },
    { name: 'bm25_only', order: (s) => orderBy(s, (x) => x.bm25Score) },
  ];
  for (const w of WEIGHTS) {
    list.push({
      name: w === 0 ? 'rrf_only' : `rrf+bm25@${w}`,
      order: (s, ranks) => orderBy(s, (x, i) => fusedScore(x, ranks[i]!, w)),
    });
  }
  return list;
}

async function main() {
  const args = process.argv.slice(2);
  // only a leading non-flag arg is the topics file (avoids grabbing flag values)
  const topicsFile = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
  const budget = Number(flag(args, '--budget') ?? 16);
  const poolCap = Number(flag(args, '--pool') ?? 50);

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return die('FIRECRAWL_API_KEY is not set.');
  const env = readLlmEnv();

  const topics = topicsFile
    ? (await readFile(resolve(process.cwd(), topicsFile), 'utf8')).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : DEFAULT_TOPICS;

  const client = new FirecrawlSearchClient(apiKey);
  const strats = strategies();
  const perStrategy = new Map<string, number[]>(strats.map((s) => [s.name, []]));

  console.error(c.bold(`ranking eval: ${topics.length} topics · judge ${env.provider}:${env.model} · nDCG@10\n`));

  for (const topic of topics) {
    process.stderr.write(c.dim(`  ${topic} — fetching… `));
    const artifact = await run(topic, { client, config: { budget, rerank: false }, llmEnv: env });
    const sources = artifact.sources;
    if (sources.length === 0) {
      console.error(c.yellow('no results, skipped'));
      continue;
    }
    const ranks = bm25Ranks(sources);

    // Pool spans the relevance spectrum so judged grades have variance (a pool of
    // only top results saturates nDCG). Union of each strategy's top-8 + an even
    // sample across the rrf-sorted list to pull in mid/tail (often marginal).
    const pool = new Map<string, MergedSource>();
    for (const s of strats) for (const src of s.order(sources, ranks).slice(0, 8)) pool.set(src.url, src);
    const byRrf = [...sources].sort((a, b) => b.rrfScore - a.rrfScore);
    for (let i = 0; i < byRrf.length; i += 3) pool.set(byRrf[i]!.url, byRrf[i]!);
    const pooled = [...pool.values()].slice(0, poolCap);

    process.stderr.write(c.dim(`judging ${pooled.length} results… `));
    const grades = new Map<string, number>();
    await mapPool(pooled, 4, async (src) => {
      const g = await judgeRelevance(topic, src.title, src.snippet, env, 90_000);
      if (g != null) grades.set(src.url, g);
    });
    if (grades.size === 0) {
      console.error(c.red('judge produced no grades (is the LLM up?), skipped'));
      continue;
    }
    const dist = [0, 0, 0, 0];
    for (const g of grades.values()) dist[g]!++;
    process.stderr.write(c.dim(`grades 0/1/2/3 = ${dist.join('/')} `));

    for (const s of strats) {
      const ordered = s.order(sources, ranks);
      const gains = ordered.map((src) => grades.get(src.url) ?? 0);
      perStrategy.get(s.name)!.push(ndcgAt(gains, 10));
    }
    console.error(c.green('done'));
  }

  // aggregate
  const rows = strats
    .map((s) => {
      const xs = perStrategy.get(s.name)!;
      const mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      return { name: s.name, mean, n: xs.length };
    })
    .sort((a, b) => b.mean - a.mean);

  console.log('\n' + c.bold('  strategy        nDCG@10   (mean over topics)'));
  for (const r of rows) {
    const bar = '▇'.repeat(Math.round(r.mean * 24));
    console.log(`  ${r.name.padEnd(14)} ${r.mean.toFixed(3)}   ${c.cyan(bar)}`);
  }
  const best = rows[0];
  if (best) {
    console.log(c.bold(`\n  best: ${best.name} (nDCG@10 ${best.mean.toFixed(3)}).`));
    if (best.name.startsWith('rrf+bm25@')) {
      console.log(`  → set DEFAULT_BM25_WEIGHT = ${best.name.split('@')[1]} (currently used by widen).`);
    }
  }

  const outPath = resolve(process.cwd(), 'runs', `eval-rank-${Date.now()}.json`);
  await writeFile(outPath, JSON.stringify({ judge: `${env.provider}:${env.model}`, topics, rows }, null, 2), 'utf8');
  console.error(c.dim(`\nwrote ${outPath}`));
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Run `fn` over items with bounded concurrency. */
async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!);
    }
  });
  await Promise.all(workers);
}
function die(msg: string): never {
  console.error(c.red(msg));
  process.exit(1);
}

main().catch((err) => {
  console.error(c.red('fatal: ') + (err as Error).message);
  process.exit(1);
});
