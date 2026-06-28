import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, domainOf } from '../src/url.js';

describe('canonicalizeUrl', () => {
  it('upgrades http to https, drops www, fragment, trailing slash', () => {
    expect(canonicalizeUrl('http://www.Example.com/Path/#frag')).toBe('https://example.com/Path');
  });

  it('strips tracking params but keeps meaningful ones, sorted', () => {
    expect(canonicalizeUrl('https://a.com/p?utm_source=x&id=2&a=1')).toBe(
      'https://a.com/p?a=1&id=2',
    );
  });

  it('keeps the root slash', () => {
    expect(canonicalizeUrl('https://a.com/')).toBe('https://a.com/');
  });

  it('treats /a/ and /a as the same source', () => {
    expect(canonicalizeUrl('https://a.com/a/')).toBe(canonicalizeUrl('https://a.com/a'));
  });

  it('returns input unchanged when unparseable', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url');
  });
});

describe('domainOf', () => {
  it('extracts registrable domain from subdomains', () => {
    expect(domainOf('https://news.bbc.co.uk/story')).toBe('bbc.co.uk');
    expect(domainOf('https://blog.example.com')).toBe('example.com');
    expect(domainOf('https://www.example.com')).toBe('example.com');
  });
});
