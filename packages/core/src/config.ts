import type { ProbeAxis, RunConfig } from './types.js';

export const ALL_AXES: ProbeAxis[] = [
  'base',
  'reformulation',
  'source-type',
  'time',
  'region',
  'niche',
];

/** Default region sweep. Each reorders the SERP and surfaces regional press. */
export const DEFAULT_REGIONS = [
  'United States',
  'United Kingdom',
  'India',
  'Australia',
  'Germany',
];

/** Time-range presets exposed to users (Firecrawl tbs values). */
export const TIME_RANGES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Any time' },
  { value: 'qdr:d', label: 'Past day' },
  { value: 'qdr:w', label: 'Past week' },
  { value: 'qdr:m', label: 'Past month' },
  { value: 'qdr:y', label: 'Past year' },
];

/**
 * Defaults tuned for the customer's shape: overnight batch, latency irrelevant,
 * coverage is the product. Budget of 24 probes is enough to see saturation on
 * most topics without runaway credit cost; adaptive stop usually ends earlier.
 */
export const DEFAULT_CONFIG: RunConfig = {
  budget: 24,
  concurrency: 6,
  perProbeLimit: 10,
  maxRetries: 3,
  perProbeTimeoutMs: 30_000,
  llm: false,
  rerank: true,
  diversity: 0.45,
  freshnessWeight: 0,
  authorityWeight: 0,
  minRelevance: 0,
  saturationMinNewDomains: 2,
  saturationPatience: 2,
  axes: ALL_AXES,
  sources: ['web', 'news'],
  categories: ['research', 'pdf'],
  regions: DEFAULT_REGIONS,
  includeDomains: [],
};

export function resolveConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

export interface LlmEnv {
  provider: 'ollama' | 'anthropic';
  baseUrl: string;
  model: string;
  apiKey?: string;
}

/** Reads LLM_* env. Falls back to local Ollama defaults so dev needs no cloud key. */
export function readLlmEnv(env: NodeJS.ProcessEnv = process.env): LlmEnv {
  const provider = (env.LLM_PROVIDER ?? 'ollama') as LlmEnv['provider'];
  const baseUrl =
    env.LLM_BASE_URL ??
    (provider === 'anthropic' ? 'https://api.anthropic.com' : 'http://localhost:11434');
  const model = env.LLM_MODEL ?? (provider === 'anthropic' ? 'claude-opus-4-8' : 'llama3.2:3b');
  return { provider, baseUrl, model, apiKey: env.ANTHROPIC_API_KEY };
}

/**
 * Env for the offline relevance judge (eval only). The judge needs a *capable*
 * model, so it prefers Anthropic Claude when an ANTHROPIC_API_KEY is present
 * (default claude-opus-4-8, override with JUDGE_MODEL), and only falls back to
 * the local LLM otherwise. Never used on the serving path.
 */
export function readJudgeEnv(env: NodeJS.ProcessEnv = process.env): LlmEnv {
  if (env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      baseUrl: env.LLM_BASE_URL ?? 'https://api.anthropic.com',
      model: env.JUDGE_MODEL ?? 'claude-opus-4-8',
      apiKey: env.ANTHROPIC_API_KEY,
    };
  }
  return readLlmEnv(env);
}
