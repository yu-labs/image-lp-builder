import { describe, expect, it } from 'vitest';
import type { Cta, CtaLink, CtaStyle } from '../../lib/content';
import {
  collectCtaSaveErrors,
  ctaEmailError,
  ctaTelError,
  ctaUrlError,
  getCtaButtonMode,
  getCtaTextPresetSelection,
  migrateCtaLink,
  validateCtaLinkForEditor,
} from './cta-editor-helpers';

function makeCta(overrides: Partial<Cta> = {}): Cta {
  return {
    id: overrides.id ?? 'cta_1',
    text: 'ボタン',
    position: { x: 50, y: 20 },
    size: { width: 60, height: 12 },
    style: (overrides.style ?? {}) as CtaStyle,
    link: overrides.link ?? { type: 'custom_url', url: 'https://example.com' },
    ...overrides,
  };
}

describe('ctaUrlError', () => {
  it('accepts absolute http(s) urls', () => {
    expect(ctaUrlError('https://example.com')).toBeNull();
    expect(ctaUrlError('http://example.com/x?y=1')).toBeNull();
  });
  it('rejects empty, relative, protocol-relative, and non-http schemes', () => {
    expect(ctaUrlError('')).not.toBeNull();
    expect(ctaUrlError('/path')).not.toBeNull();
    expect(ctaUrlError('//evil.com')).not.toBeNull();
    expect(ctaUrlError('ftp://example.com')).not.toBeNull();
    expect(ctaUrlError('not a url')).not.toBeNull();
  });
});

describe('ctaTelError / ctaEmailError', () => {
  it('accepts sane phone numbers and flags junk', () => {
    expect(ctaTelError('0120-12-3456')).toBeNull();
    expect(ctaTelError('+81 (90) 1234-5678')).toBeNull();
    expect(ctaTelError('')).not.toBeNull();
    expect(ctaTelError('call me')).not.toBeNull();
  });
  it('accepts valid emails and flags junk', () => {
    expect(ctaEmailError('a@b.co')).toBeNull();
    expect(ctaEmailError('')).not.toBeNull();
    expect(ctaEmailError('a@b')).not.toBeNull();
    expect(ctaEmailError('nope')).not.toBeNull();
  });
});

describe('validateCtaLinkForEditor', () => {
  it('passes a valid custom_url and flags a blank one', () => {
    expect(
      validateCtaLinkForEditor({ type: 'custom_url', url: 'https://x.com' }),
    ).toEqual([]);
    expect(
      validateCtaLinkForEditor({ type: 'custom_url', url: '' }),
    ).not.toEqual([]);
  });
  it('accepts a custom_url backed by a selected my_link', () => {
    expect(
      validateCtaLinkForEditor({
        type: 'custom_url',
        url: 'https://resolved.example',
        myLinkId: 'ml_1',
      }),
    ).toEqual([]);
  });
  it('requires both url and tag for webhook', () => {
    const errs = validateCtaLinkForEditor({
      type: 'webhook',
      url: '',
      tag: '',
    });
    expect(errs.length).toBe(2);
  });
});

describe('getCtaButtonMode', () => {
  it('honors an explicit buttonMode', () => {
    expect(getCtaButtonMode(makeCta({ buttonMode: 'image' }))).toBe('image');
  });
  it('falls back to image when an image is present, else text', () => {
    expect(
      getCtaButtonMode(
        makeCta({ image: { url: 'u', width: 1, height: 1 } }),
      ),
    ).toBe('image');
    expect(getCtaButtonMode(makeCta())).toBe('text');
  });
});

describe('collectCtaSaveErrors', () => {
  it('reports the image-button-without-image case', () => {
    const groups = collectCtaSaveErrors([makeCta({ buttonMode: 'image' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].messages.join()).toContain('画像');
  });
  it('returns no groups when every cta is valid', () => {
    expect(collectCtaSaveErrors([makeCta()])).toEqual([]);
  });
});

describe('getCtaTextPresetSelection', () => {
  it('derives the preset from link type and template', () => {
    expect(
      getCtaTextPresetSelection(makeCta({ link: { type: 'tel', number: '1' } })),
    ).toBe('tel');
    expect(
      getCtaTextPresetSelection(
        makeCta({ link: { type: 'mailto', email: 'a@b.co' } }),
      ),
    ).toBe('mailto');
    expect(
      getCtaTextPresetSelection(
        makeCta({ style: { template: 'apply' } as CtaStyle }),
      ),
    ).toBe('apply');
    expect(
      getCtaTextPresetSelection(
        makeCta({ style: { iconLeft: 'line' } as CtaStyle }),
      ),
    ).toBe('line-friend');
    expect(getCtaTextPresetSelection(makeCta())).toBe('simple');
  });
});

describe('migrateCtaLink', () => {
  it('carries the url across url-like link types', () => {
    const from: CtaLink = { type: 'custom_url', url: 'https://x.com' };
    expect(migrateCtaLink(from, { type: 'line_friend', url: '' })).toEqual({
      type: 'line_friend',
      url: 'https://x.com',
    });
  });
  it('preserves tel and mailto values when re-selecting the same type', () => {
    expect(
      migrateCtaLink({ type: 'tel', number: '0120' }, { type: 'tel', number: '' }),
    ).toEqual({ type: 'tel', number: '0120' });
  });
  it('drops incompatible values when switching to an unrelated type', () => {
    expect(
      migrateCtaLink({ type: 'tel', number: '0120' }, {
        type: 'custom_url',
        url: '',
      }),
    ).toEqual({ type: 'custom_url', url: '' });
  });
});
