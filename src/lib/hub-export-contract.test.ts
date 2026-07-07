import { describe, expect, it } from 'vitest';
import {
  HUB_EXPORT_CONTRACT_VERSION,
  validateHubExportPayload,
} from './hub-export-contract';

function validPayload(): Record<string, unknown> {
  return {
    page: { id: 'lp_1' },
    version: { id: 'ver_1' },
    publication: { id: 'pub_1' },
    sections: [],
    ctas: [],
    images: [],
    public_url: 'https://lp.example.com/spring',
  };
}

describe('validateHubExportPayload', () => {
  it('exposes a stable contract version', () => {
    expect(HUB_EXPORT_CONTRACT_VERSION).toBe(1);
  });

  it('accepts a well-formed payload and trims public_url', () => {
    const result = validateHubExportPayload({
      ...validPayload(),
      public_url: '  https://lp.example.com/spring  ',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.public_url).toBe('https://lp.example.com/spring');
    }
  });

  it('normalizes blank / missing / non-string public_url to null', () => {
    for (const value of ['   ', undefined, 42, null]) {
      const result = validateHubExportPayload({
        ...validPayload(),
        public_url: value,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.payload.public_url).toBeNull();
    }
  });

  it('rejects non-object payloads', () => {
    for (const value of [null, undefined, 'text', 7, ['x']]) {
      expect(validateHubExportPayload(value).ok).toBe(false);
    }
  });

  it('requires non-empty ids on page / version / publication', () => {
    for (const key of ['page', 'version', 'publication'] as const) {
      const result = validateHubExportPayload({
        ...validPayload(),
        [key]: { id: '  ' },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContain(`${key}.id is required`);
    }
  });

  it('requires sections / ctas / images to be arrays', () => {
    for (const key of ['sections', 'ctas', 'images'] as const) {
      const result = validateHubExportPayload({
        ...validPayload(),
        [key]: 'nope',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors).toContain(`${key} must be an array`);
    }
  });
});
