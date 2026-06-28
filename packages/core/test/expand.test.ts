import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { deterministicProbes, dedupeProbes } from '../src/expand/deterministic.js';
import { parseQueries } from '../src/expand/llm.js';

describe('deterministicProbes', () => {
  const cfg = resolveConfig();

  it('always includes an untouched base probe', () => {
    const probes = deterministicProbes('electric vehicles', cfg);
    const base = probes.filter((p) => p.axis === 'base');
    expect(base).toHaveLength(1);
    expect(base[0]!.query).toBe('electric vehicles');
  });

  it('covers every requested axis', () => {
    const probes = deterministicProbes('q', cfg);
    const axes = new Set(probes.map((p) => p.axis));
    expect(axes).toEqual(new Set(['base', 'reformulation', 'source-type', 'time', 'region']));
  });

  it('produces stable, unique ids for distinct probes', () => {
    const probes = deterministicProbes('q', cfg);
    const ids = probes.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is deterministic across calls', () => {
    const a = deterministicProbes('same query', cfg).map((p) => p.id);
    const b = deterministicProbes('same query', cfg).map((p) => p.id);
    expect(a).toEqual(b);
  });

  it('honors an axis subset', () => {
    const probes = deterministicProbes('q', resolveConfig({ axes: ['base', 'time'] }));
    expect(new Set(probes.map((p) => p.axis))).toEqual(new Set(['base', 'time']));
  });

  it('puts the user location first in the region sweep', () => {
    const probes = deterministicProbes('q', resolveConfig({ location: 'Japan', axes: ['region'] }));
    expect(probes[0]!.params.location).toBe('Japan');
  });
});

describe('dedupeProbes', () => {
  it('drops probes with identical ids', () => {
    const probes = deterministicProbes('q', resolveConfig());
    expect(dedupeProbes([...probes, ...probes])).toHaveLength(probes.length);
  });
});

describe('parseQueries', () => {
  it('extracts a JSON array embedded in prose and fences', () => {
    const text = 'Sure!\n```json\n["a", "b", "c"]\n```';
    expect(parseQueries(text)).toEqual(['a', 'b', 'c']);
  });

  it('ignores <think> blocks from reasoning models', () => {
    const text = '<think>let me consider</think>\n["x", "y"]';
    expect(parseQueries(text)).toEqual(['x', 'y']);
  });

  it('returns [] when no array present', () => {
    expect(parseQueries('no json here')).toEqual([]);
  });

  it('drops non-strings and blanks', () => {
    expect(parseQueries('[1, "ok", "", "  "]')).toEqual(['ok']);
  });
});
