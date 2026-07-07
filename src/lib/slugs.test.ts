import { describe, expect, it } from 'vitest';
import {
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
} from './slugs';

describe('SLUG_PATTERN', () => {
  it('accepts lowercase alphanumeric slugs with single hyphen separators', () => {
    for (const slug of ['a', 'spring', 'ai-camp-2026', 'lp1']) {
      expect(SLUG_PATTERN.test(slug)).toBe(true);
    }
  });

  it('rejects uppercase, spaces, and edge / doubled hyphens', () => {
    for (const slug of ['Spring', 'ai camp', '-lead', 'trail-', 'a--b', '']) {
      expect(SLUG_PATTERN.test(slug)).toBe(false);
    }
  });

  it('rejects path-traversal and separator characters', () => {
    for (const slug of ['a/b', '..', 'foo.bar', 'a_b']) {
      expect(SLUG_PATTERN.test(slug)).toBe(false);
    }
  });
});

describe('RESERVED_SLUGS', () => {
  it('reserves the routing / framework paths that must not be LP slugs', () => {
    for (const reserved of ['admin', 'api', 'go', '_astro', '404', 'preview']) {
      expect(RESERVED_SLUGS.has(reserved)).toBe(true);
    }
  });

  it('does not reserve ordinary campaign slugs', () => {
    for (const slug of ['spring', 'ai-camp', 'campaign1']) {
      expect(RESERVED_SLUGS.has(slug)).toBe(false);
    }
  });

  it('keeps a sane max slug length', () => {
    expect(SLUG_MAX_LENGTH).toBeGreaterThan(0);
  });
});
