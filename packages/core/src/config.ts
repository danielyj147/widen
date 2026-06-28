import type { ProbeAxis, RunConfig } from './types.js';

export const ALL_AXES: ProbeAxis[] = [
  'base',
  'reformulation',
  'source-type',
  'time',
  'region',
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
  saturationMinNewDomains: 2,
  saturationPatience: 2,
  axes: ALL_AXES,
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
  const model = env.LLM_MODEL ?? (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'llama3.2:3b');
  return { provider, baseUrl, model, apiKey: env.ANTHROPIC_API_KEY };
}
