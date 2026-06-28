import { describe, expect, it } from 'vitest';
import { classifyError, normalizeResults, runProbeWith } from '../src/firecrawl.js';
import type { Probe } from '../src/types.js';

const probe: Probe = {
  id: 'p1',
  query: 'q',
  axis: 'base',
  params: { limit: 10 },
  rationale: 'test',
};

const noSleep = async () => {};

describe('normalizeResults', () => {
  it('flattens web and news arrays and skips entries without url', () => {
    const data = {
      web: [
        { url: 'https://a.com', title: 'A', description: 'da' },
        { title: 'no url' },
      ],
      news: [{ url: 'https://b.com', title: 'B', snippet: 'sb', position: 4 }],
    };
    const out = normalizeResults(data);
    expect(out).toEqual([
      { url: 'https://a.com', title: 'A', snippet: 'da', source: 'web', position: 1 },
      { url: 'https://b.com', title: 'B', snippet: 'sb', source: 'news', position: 4 },
    ]);
  });

  it('handles null/empty safely', () => {
    expect(normalizeResults(null)).toEqual([]);
    expect(normalizeResults({})).toEqual([]);
  });
});

describe('classifyError', () => {
  it('maps messages to statuses', () => {
    expect(classifyError(new Error('Request aborted')).status).toBe('timeout');
    expect(classifyError(new Error('429 Too Many Requests')).status).toBe('rate-limited');
    expect(classifyError(new Error('boom')).status).toBe('error');
  });
});

describe('runProbeWith', () => {
  it('returns ok with normalized results on success', async () => {
    const res = await runProbeWith(
      probe,
      async () => ({ web: [{ url: 'https://a.com', title: 'A', description: 'd' }] }),
      { maxRetries: 3, timeoutMs: 1000, sleep: noSleep },
    );
    expect(res.status).toBe('ok');
    expect(res.results).toHaveLength(1);
    expect(res.attempts).toBe(1);
  });

  it('marks empty when no results', async () => {
    const res = await runProbeWith(probe, async () => ({ web: [] }), {
      maxRetries: 3,
      timeoutMs: 1000,
      sleep: noSleep,
    });
    expect(res.status).toBe('empty');
  });

  it('retries retryable errors then succeeds', async () => {
    let n = 0;
    const res = await runProbeWith(
      probe,
      async () => {
        n++;
        if (n < 3) throw new Error('429 rate limit');
        return { web: [{ url: 'https://a.com' }] };
      },
      { maxRetries: 5, timeoutMs: 1000, sleep: noSleep },
    );
    expect(res.status).toBe('ok');
    expect(res.attempts).toBe(3);
  });

  it('gives up after maxRetries and reports the classified status', async () => {
    const res = await runProbeWith(
      probe,
      async () => {
        throw new Error('429 too many requests');
      },
      { maxRetries: 2, timeoutMs: 1000, sleep: noSleep },
    );
    expect(res.status).toBe('rate-limited');
    expect(res.attempts).toBe(2);
    expect(res.error).toContain('429');
  });
});
