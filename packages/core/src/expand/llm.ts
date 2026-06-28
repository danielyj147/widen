import type { LlmEnv } from '../config.js';
import type { Probe, ProbeParams, RunConfig } from '../types.js';
import { probeId } from './deterministic.js';

/**
 * Optional LLM-enhanced expansion. The LLM only does the one thing it is good at
 * and deterministic code is bad at: inventing topically-diverse *reformulations*
 * (synonyms, sub-facets, adjacent entities). It never controls params — those
 * stay deterministic — so a hallucinating model can at worst add a weak query,
 * never a malformed request. Off by default; runs with only a Firecrawl key.
 */

const SYSTEM_PROMPT =
  'You expand a search topic into diverse sub-queries that surface DIFFERENT sources ' +
  '(trade publications, regional press, niche forums, primary documents), not more of ' +
  'the same popular pages. Avoid near-duplicates of the original. Return ONLY a JSON ' +
  'array of 8-12 short query strings. No prose, no markdown, no keys.';

function userPrompt(query: string): string {
  return `Topic: "${query}"\nReturn the JSON array of sub-queries now.`;
}

/**
 * Provider-agnostic chat completion returning raw model text. Throws on
 * transport/HTTP errors. Shared by probe expansion and the relevance judge.
 */
export async function llmChat(
  env: LlmEnv,
  system: string,
  user: string,
  signal: AbortSignal,
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  if (env.provider === 'anthropic') return chatAnthropic(env, system, user, signal, opts);
  return chatOllama(env, system, user, signal, opts);
}

async function chatOllama(
  env: LlmEnv,
  system: string,
  user: string,
  signal: AbortSignal,
  opts: { temperature?: number },
): Promise<string> {
  // Ollama's OpenAI-compatible endpoint. One env flip swaps to any OpenAI-shaped API.
  const res = await fetch(`${env.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: env.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: opts.temperature ?? 0.7,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text().catch(() => '')}`);
  const json: any = await res.json();
  return json?.choices?.[0]?.message?.content ?? '';
}

async function chatAnthropic(
  env: LlmEnv,
  system: string,
  user: string,
  signal: AbortSignal,
  opts: { maxTokens?: number },
): Promise<string> {
  if (!env.apiKey) throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
  const res = await fetch(`${env.baseUrl.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal,
    body: JSON.stringify({
      model: env.model,
      max_tokens: opts.maxTokens ?? 1024,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text().catch(() => '')}`);
  const json: any = await res.json();
  return (json?.content ?? []).map((b: any) => b?.text ?? '').join('');
}

/**
 * Pull a JSON array of strings out of model text. Tolerates code fences, <think>
 * blocks (deepseek), and leading prose — we extract the first bracketed array.
 */
export function parseQueries(text: string): string[] {
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(stripped.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Returns reformulation probes from the LLM, or [] on any failure. Never throws:
 * LLM enhancement is best-effort and must not take down a run.
 */
export async function llmProbes(
  query: string,
  cfg: RunConfig,
  env: LlmEnv,
  timeoutMs = 20_000,
): Promise<Probe[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const text = await llmChat(env, SYSTEM_PROMPT, userPrompt(query), ac.signal);
    const queries = parseQueries(text)
      .filter((s) => s.toLowerCase() !== query.toLowerCase())
      .slice(0, 12);
    return queries.map((q) => {
      const params: ProbeParams = { limit: cfg.perProbeLimit, sources: ['web'] };
      return {
        id: probeId(q, params),
        query: q,
        axis: 'reformulation' as const,
        params,
        rationale: `LLM (${env.provider}:${env.model}) reformulation`,
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
