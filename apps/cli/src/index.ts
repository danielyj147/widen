#!/usr/bin/env -S node --import tsx
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  ALL_AXES,
  FirecrawlSearchClient,
  listRuns,
  loadRun,
  readLlmEnv,
  run,
  saveRun,
  type ProbeAxis,
  type ProgressEvent,
  type RunArtifact,
  type RunConfig,
} from '@widen/core';
import { renderArtifact, renderRunList } from './report.js';
import { c, statusGlyph } from './ui.js';

const HELP = `${c.bold('widen')} — search wider, not deeper. A recall-maximizing layer on Firecrawl /search.

${c.bold('USAGE')}
  widen search "<query>" [options]     run one query
  widen batch <file> [options]         run many queries (one per line) — overnight-job shape
  widen list [--out <dir>]             list past runs
  widen show <run-id> [--out <dir>]    print a saved run's report

${c.bold('OPTIONS')}
  --budget <n>        max search probes to issue — more = wider coverage, more credits  (default 24)
  --concurrency <n>   probes in flight at once        (default 6)
  --limit <n>         results per probe               (default 10)
  --sources <list>    result sources: web,news,images           (default web,news)
  --categories <list> categories: research,pdf,github           (default research,pdf)
  --regions <list>    comma list of regions to sweep, e.g. "Germany,Japan"
  --location <name>   primary region bias (added to the sweep)
  --time <range>      time filter: day | week | month | year | any  (default any)
  --max-age <days>    results no older than N days (precise; overrides --time)
  --include-domains <list>  niche sites to search directly (find non-SEO sources), e.g. "tradepub.com,forum.org"
  --axes <list>       comma list of: ${ALL_AXES.join(',')}
  --llm               use LLM-enhanced expansion (reads LLM_* env; off by default)
  --diversity <0..1>  MMR diversity: 0 = pure relevance, 1 = max source spread  (default 0.45)
  --min-relevance <0..1>  drop sub-threshold sources from the result list  (default 0)
  --no-rerank         keep discovery order (skip relevance ranking + diversity)
  --out <dir>         where run artifacts live        (default ./runs)
  --no-save           don't write an artifact
  --json              print the full artifact as JSON (implies --quiet)
  --quiet             suppress live progress

${c.bold('ENV')}
  FIRECRAWL_API_KEY   required.
  LLM_PROVIDER/LLM_BASE_URL/LLM_MODEL/ANTHROPIC_API_KEY   only for --llm.
`;

function fail(msg: string): never {
  console.error(c.red('error: ') + msg);
  process.exit(1);
}

function requireApiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) {
    fail('FIRECRAWL_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
  return key;
}

interface CliOpts {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

function parse(argv: string[]): CliOpts {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      budget: { type: 'string' },
      concurrency: { type: 'string' },
      limit: { type: 'string' },
      location: { type: 'string' },
      sources: { type: 'string' },
      categories: { type: 'string' },
      regions: { type: 'string' },
      time: { type: 'string' },
      'max-age': { type: 'string' },
      'include-domains': { type: 'string' },
      diversity: { type: 'string' },
      'min-relevance': { type: 'string' },
      axes: { type: 'string' },
      out: { type: 'string' },
      llm: { type: 'boolean' },
      'no-rerank': { type: 'boolean' },
      'no-save': { type: 'boolean' },
      json: { type: 'boolean' },
      quiet: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  return { values, positionals };
}

function configFrom(values: CliOpts['values']): Partial<RunConfig> {
  const cfg: Partial<RunConfig> = {};
  if (values.budget) cfg.budget = int('--budget', values.budget as string);
  if (values.concurrency) cfg.concurrency = int('--concurrency', values.concurrency as string);
  if (values.limit) cfg.perProbeLimit = int('--limit', values.limit as string);
  if (values.location) cfg.location = values.location as string;
  if (values.llm) cfg.llm = true;
  if (values['no-rerank']) cfg.rerank = false;
  if (values.diversity != null) cfg.diversity = unit('--diversity', values.diversity as string);
  if (values['min-relevance'] != null)
    cfg.minRelevance = unit('--min-relevance', values['min-relevance'] as string);
  if (values.sources) {
    const valid = ['web', 'news', 'images'];
    const list = csv(values.sources as string);
    const bad = list.filter((s) => !valid.includes(s));
    if (bad.length) fail(`unknown sources: ${bad.join(', ')}. valid: ${valid.join(', ')}`);
    cfg.sources = list as RunConfig['sources'];
  }
  if (values.categories) {
    const valid = ['research', 'pdf', 'github'];
    const list = csv(values.categories as string);
    const bad = list.filter((s) => !valid.includes(s));
    if (bad.length) fail(`unknown categories: ${bad.join(', ')}. valid: ${valid.join(', ')}`);
    cfg.categories = list as RunConfig['categories'];
  }
  if (values.regions) cfg.regions = csv(values.regions as string);
  if (values['include-domains']) cfg.includeDomains = csv(values['include-domains'] as string);
  if (values.time) cfg.timeRange = parseTimeRange(values.time as string);
  if (values['max-age']) cfg.maxAgeDays = int('--max-age', values['max-age'] as string);
  if (values.axes) {
    const axes = (values.axes as string).split(',').map((a) => a.trim()) as ProbeAxis[];
    const bad = axes.filter((a) => !ALL_AXES.includes(a));
    if (bad.length) fail(`unknown axes: ${bad.join(', ')}. valid: ${ALL_AXES.join(', ')}`);
    cfg.axes = axes;
  }
  return cfg;
}

function int(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) fail(`${flag} must be a positive integer, got "${raw}"`);
  return n;
}

function unit(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) fail(`${flag} must be between 0 and 1, got "${raw}"`);
  return n;
}

function csv(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const TIME_MAP: Record<string, string> = {
  day: 'qdr:d',
  week: 'qdr:w',
  month: 'qdr:m',
  year: 'qdr:y',
  any: '',
};
function parseTimeRange(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!(key in TIME_MAP)) fail(`--time must be one of: ${Object.keys(TIME_MAP).join(', ')}`);
  return TIME_MAP[key]!;
}

function outDir(values: CliOpts['values']): string {
  return resolve(process.cwd(), (values.out as string) ?? 'runs');
}

/** Live progress printer wired to the engine's events. */
function progressPrinter(quiet: boolean): (ev: ProgressEvent) => void {
  if (quiet) return () => {};
  return (ev) => {
    switch (ev.type) {
      case 'expanded':
        console.error(
          c.dim(
            `expanded into ${ev.probeCount} candidate probes` +
              (ev.llmUsed ? ' (LLM-enhanced)' : ev.llmError ? ` (LLM skipped: ${ev.llmError})` : ''),
          ),
        );
        break;
      case 'wave-start':
        console.error(c.dim(`wave ${ev.wave}: issuing ${ev.size} probes (${ev.issued}/${ev.budget} done)`));
        break;
      case 'probe-done': {
        const { probe, result } = ev;
        const n = result.results.length;
        console.error(
          `  ${statusGlyph(result.status)} ${c.gray(probe.axis.padEnd(13))} ${c.cyan(String(n).padStart(2))} hits  ${c.dim(probe.query.slice(0, 60))}`,
        );
        break;
      }
      case 'wave-end':
        console.error(c.dim(`  └ +${ev.newDomains} new domains (cumulative ${ev.cumulativeDomains})`));
        break;
      case 'stopping':
        console.error(c.green(`stopping early: ${ev.reason}`));
        break;
    }
  };
}

async function doRun(query: string, values: CliOpts['values']): Promise<RunArtifact> {
  const apiKey = requireApiKey();
  const quiet = Boolean(values.quiet || values.json);
  const client = new FirecrawlSearchClient(apiKey);
  const artifact = await run(query, {
    client,
    config: configFrom(values),
    llmEnv: readLlmEnv(),
    onProgress: progressPrinter(quiet),
  });
  if (!values['no-save']) {
    const path = await saveRun(outDir(values), artifact);
    if (!quiet) console.error(c.dim(`saved ${path}`));
  }
  return artifact;
}

async function cmdSearch(opts: CliOpts) {
  const query = opts.positionals[0];
  if (!query) fail('search needs a query, e.g. widen search "ev charging standards"');
  const artifact = await doRun(query, opts.values);
  if (opts.values.json) {
    process.stdout.write(JSON.stringify(artifact, null, 2) + '\n');
  } else {
    process.stdout.write(renderArtifact(artifact));
  }
}

async function cmdBatch(opts: CliOpts) {
  const file = opts.positionals[0];
  if (!file) fail('batch needs a file of queries, one per line');
  const raw = await readFile(resolve(process.cwd(), file), 'utf8').catch(() => fail(`cannot read ${file}`));
  const queries = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!queries.length) fail(`${file} has no queries`);

  console.error(c.bold(`batch: ${queries.length} queries`));
  const summaries: RunArtifact[] = [];
  for (const [i, q] of queries.entries()) {
    console.error(c.blue(`\n[${i + 1}/${queries.length}] ${q}`));
    try {
      summaries.push(await doRun(q, opts.values));
    } catch (err) {
      console.error(c.red(`  failed: ${(err as Error).message}`));
    }
  }
  process.stdout.write('\n' + renderRunList(summaries.map((a) => a)) + '\n');
  const thin = summaries.filter((a) => a.coverage.verdict === 'thin').length;
  if (thin) console.error(c.yellow(`\n${thin}/${summaries.length} runs returned THIN coverage — flagged above.`));
}

async function cmdList(opts: CliOpts) {
  const runs = await listRuns(outDir(opts.values));
  if (!runs.length) {
    console.error(c.dim('no runs yet. try: widen search "your topic"'));
    return;
  }
  process.stdout.write(renderRunList(runs) + '\n');
}

async function cmdShow(opts: CliOpts) {
  const id = opts.positionals[0];
  if (!id) fail('show needs a run id (see `widen list`)');
  const artifact = await loadRun(outDir(opts.values), id).catch(() => fail(`no run ${id} in ${outDir(opts.values)}`));
  if (opts.values.json) process.stdout.write(JSON.stringify(artifact, null, 2) + '\n');
  else process.stdout.write(renderArtifact(artifact));
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return;
  }
  const opts = parse(argv.slice(1));
  if (opts.values.help) {
    process.stdout.write(HELP);
    return;
  }
  switch (command) {
    case 'search':
      return cmdSearch(opts);
    case 'batch':
      return cmdBatch(opts);
    case 'list':
      return cmdList(opts);
    case 'show':
      return cmdShow(opts);
    default:
      fail(`unknown command "${command}". run \`widen help\`.`);
  }
}

main().catch((err) => {
  console.error(c.red('\nfatal: ') + (err as Error).message);
  process.exit(1);
});
