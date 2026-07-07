import { afterEach, describe, expect, it } from 'vitest';
import { env, resetEnv } from '../../test/mocks/cloudflare-workers';
import {
  REPO_SLUG,
  compareSemver,
  isCriticalRelease,
  resolveUpdateSourceRepo,
} from './version';

afterEach(() => resetEnv());

describe('compareSemver', () => {
  it('orders versions numerically, not lexically', () => {
    expect(compareSemver('0.9.0', '0.10.0')).toBe(-1);
    expect(compareSemver('0.10.0', '0.9.0')).toBe(1);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('treats missing components as zero', () => {
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
    expect(compareSemver('1', '1.0.1')).toBe(-1);
  });

  it('ignores pre-release / build metadata', () => {
    expect(compareSemver('0.1.7-test.1', '0.1.7')).toBe(0);
    expect(compareSemver('0.1.7+build', '0.1.7')).toBe(0);
  });
});

describe('isCriticalRelease', () => {
  it('matches the [critical] tag case-insensitively', () => {
    expect(isCriticalRelease('v1.2.3 [critical] security fix')).toBe(true);
    expect(isCriticalRelease('[CRITICAL] data loss')).toBe(true);
  });

  it('is false for normal or missing names', () => {
    expect(isCriticalRelease('v1.2.3 normal update')).toBe(false);
    expect(isCriticalRelease(null)).toBe(false);
  });
});

describe('resolveUpdateSourceRepo', () => {
  it('defaults to the project repo when unset', () => {
    expect(resolveUpdateSourceRepo()).toBe(REPO_SLUG);
  });

  it('honors a valid owner/name override', () => {
    env.UPDATE_SOURCE_REPO = 'yu-labs/image-lp-builder-staging';
    expect(resolveUpdateSourceRepo()).toBe('yu-labs/image-lp-builder-staging');
  });

  it('trims surrounding whitespace on the override', () => {
    env.UPDATE_SOURCE_REPO = '  owner/name  ';
    expect(resolveUpdateSourceRepo()).toBe('owner/name');
  });

  it('falls back to the default for malformed or non-string values', () => {
    for (const bad of ['no-slash', 'a/b/c', 'a b/c', '', 42, null, undefined]) {
      env.UPDATE_SOURCE_REPO = bad;
      expect(resolveUpdateSourceRepo()).toBe(REPO_SLUG);
    }
  });
});
