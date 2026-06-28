import { readLlmEnv, type LlmEnv } from '../config.js';
import type { Probe, RunConfig } from '../types.js';
import { deterministicProbes, dedupeProbes } from './deterministic.js';
import { llmProbes } from './llm.js';

export { deterministicProbes, dedupeProbes, probeId } from './deterministic.js';
export { llmProbes, parseQueries } from './llm.js';

export interface ExpandResult {
  probes: Probe[];
  llmUsed: boolean;
  llmError?: string;
}

/**
 * Produce the prioritized candidate probe list. Deterministic probes always
 * come first (they are the reliable backbone); LLM reformulations are appended
 * and deduped. The orchestrator caps the list to the budget, so ordering here
 * is what decides which probes survive a tight budget.
 */
export async function expand(
  query: string,
  cfg: RunConfig,
  env: LlmEnv = readLlmEnv(),
): Promise<ExpandResult> {
  const base = deterministicProbes(query, cfg);
  if (!cfg.llm) return { probes: base, llmUsed: false };

  const llm = await llmProbes(query, cfg, env);
  if (llm.length === 0) {
    return { probes: base, llmUsed: false, llmError: 'LLM returned no usable queries' };
  }
  // Interleave: keep base backbone first, then LLM ideas, then dedupe by id.
  return { probes: dedupeProbes([...base, ...llm]), llmUsed: true };
}
