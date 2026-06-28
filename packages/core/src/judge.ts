import { readJudgeEnv, type LlmEnv } from './config.js';
import { llmChat } from './expand/llm.js';

/**
 * LLM-as-judge graded relevance, for offline ranking evaluation only (never on
 * the serving path). Industry-standard when human labels are unavailable; we use
 * it to compare ranking strategies, not to rank live results. Grades are a
 * proxy — a small local model is noisy — so the eval reports the judge model and
 * treats differences cautiously.
 */

const JUDGE_SYSTEM =
  'You are a STRICT search-relevance judge. Most results only partially match — ' +
  'do not be generous. Rate how well the result answers the SPECIFIC query:\n' +
  '0 = off-topic or only shares a keyword\n' +
  '1 = related to the broad subject but not the specific intent\n' +
  '2 = on the specific intent but generic or incomplete\n' +
  '3 = directly and fully answers the specific query\n' +
  'Reserve 3 for clear best-answers. Reply with ONLY the single digit 0, 1, 2, or 3.';

function judgePrompt(query: string, title: string, snippet: string): string {
  return `Query: ${query}\n\nResult title: ${title}\nResult snippet: ${snippet}\n\nGrade (0-3):`;
}

/** Parse the grade out of the model's reply; null if none. Strips <think>
 *  blocks first (reasoning models emit digits mid-thought we must ignore). */
export function parseGrade(text: string): number | null {
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const m = stripped.match(/[0-3]/);
  return m ? Number(m[0]) : null;
}

/** Grade one (query, result). Returns null on failure so the caller can skip it. */
export async function judgeRelevance(
  query: string,
  title: string,
  snippet: string,
  env: LlmEnv = readJudgeEnv(),
  timeoutMs = 20_000,
): Promise<number | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const text = await llmChat(env, JUDGE_SYSTEM, judgePrompt(query, title, snippet), ac.signal, {
      temperature: 0,
      maxTokens: 8,
    });
    return parseGrade(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
