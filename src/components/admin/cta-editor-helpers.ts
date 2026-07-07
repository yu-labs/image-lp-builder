/**
 * Framework-free helpers for the CTA editor: validation, link
 * migration, and small derivations. Extracted from CtaEditor.tsx so
 * the pure logic can be unit-tested and the component file stays
 * focused on rendering. All imports here are type-only, so this module
 * pulls in no runtime dependencies.
 */

import type { Cta, CtaLink } from '../../lib/content';
import type { CtaPresetId } from './CtaPresets';

export type CtaButtonMode = NonNullable<Cta['buttonMode']>;
export type CtaTextPresetSelection = CtaPresetId;

/** A "よく使うリンク" entry the CTA link form can point at. */
export interface MyLink {
  id: string;
  label: string;
  url: string;
}

export interface SaveErrorGroup {
  ctaId: string;
  title: string;
  messages: string[];
}

export function initialCtaPosition(
  template: Omit<Cta, 'id'>,
  existingCount: number,
): Cta['position'] {
  const x = template.position.x;
  const y = Math.min(42, 12 + existingCount * 15);
  return { x, y };
}

export function serializeCtas(ctas: Cta[]): string {
  return JSON.stringify(ctas);
}

// Mirror of the lenient checks in src/lib/content.ts so the editor
// can flag bad tel / mailto values before the save round-trips and
// the visitor ends up tapping a broken `tel:` / `mailto:` link.
const CTA_TEL_PATTERN = /^[+\d\s().-]+$/;
const CTA_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors src/lib/url.ts:validateUrlScheme with `kind: 'absolute'`.
// CTA destinations always need an absolute URL — relative paths
// would resolve against the public LP origin, which isn't useful
// for URL-based CTA destinations.
export function ctaUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'URLを入力してください';
  if (trimmed.startsWith('//') || trimmed.startsWith('/')) {
    return 'http:// またはhttps:// で始まるURLを入力してください';
  }
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'http:// またはhttps:// で始まるURLを入力してください';
    }
    return null;
  } catch {
    return 'URLの形式が正しくありません（http:// やhttps:// で始める）';
  }
}

export function ctaTelError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '電話番号を入力してください';
  if (!CTA_TEL_PATTERN.test(trimmed)) {
    return '半角数字と + ( ) - スペース のみ使えます';
  }
  return null;
}

export function ctaEmailError(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'メールアドレスを入力してください';
  if (!CTA_EMAIL_PATTERN.test(trimmed)) {
    return '形式が正しくありません（例： someone@example.com）';
  }
  return null;
}

export function validateCtaLinkForEditor(link: CtaLink): string[] {
  switch (link.type) {
    case 'line_friend': {
      if (!link.url?.trim()) return ['URLを入力してください'];
      const err = ctaUrlError(link.url);
      return err ? [`URL: ${err}`] : [];
    }
    case 'custom_url': {
      if (link.myLinkId) {
        return link.url?.trim() ? [] : ['よく使うリンクを選択してください'];
      }
      if (!link.url?.trim()) return ['リンク先URLを入力してください'];
      const err = ctaUrlError(link.url);
      return err ? [`リンク先URL: ${err}`] : [];
    }
    case 'tel': {
      const err = ctaTelError(link.number);
      return err ? [err] : [];
    }
    case 'mailto': {
      const err = ctaEmailError(link.email);
      return err ? [err] : [];
    }
    case 'webhook': {
      const errors: string[] = [];
      if (!link.url?.trim()) {
        errors.push('Webhook URLを入力してください');
      } else {
        const urlErr = ctaUrlError(link.url);
        if (urlErr) errors.push(`Webhook URL: ${urlErr}`);
      }
      if (!link.tag?.trim()) errors.push('Webhookのタグを入力してください');
      return errors;
    }
  }
}

export function getCtaButtonMode(cta: Cta): CtaButtonMode {
  return cta.buttonMode ?? (cta.image ? 'image' : 'text');
}

export function collectCtaSaveErrors(ctas: Cta[]): SaveErrorGroup[] {
  const errors: SaveErrorGroup[] = [];
  ctas.forEach((cta, index) => {
    const messages: string[] = [];
    if (getCtaButtonMode(cta) === 'image' && !cta.image) {
      messages.push('画像ボタン: 画像を選択してください');
    }
    messages.push(...validateCtaLinkForEditor(cta.link));
    if (messages.length > 0) {
      errors.push({
        ctaId: cta.id,
        title: `ボタン${index + 1}`,
        messages,
      });
    }
  });
  return errors;
}

export function getCtaTextPresetSelection(cta: Cta): CtaTextPresetSelection {
  if (cta.link.type === 'tel' || cta.style.template === 'phone') return 'tel';
  if (cta.link.type === 'mailto' || cta.style.template === 'mail') return 'mailto';
  if (cta.style.template === 'apply') return 'apply';
  if (cta.style.template === 'line' || cta.style.iconLeft === 'line') {
    return 'line-friend';
  }
  return 'simple';
}

export function migrateCtaLink(current: CtaLink, next: CtaLink): CtaLink {
  switch (next.type) {
    case 'custom_url': {
      if (
        current.type === 'custom_url' ||
        current.type === 'line_friend' ||
        current.type === 'webhook'
      ) {
        return { type: 'custom_url', url: current.url ?? '' };
      }
      return next;
    }
    case 'line_friend': {
      if (
        current.type === 'custom_url' ||
        current.type === 'line_friend' ||
        current.type === 'webhook'
      ) {
        return { type: 'line_friend', url: current.url ?? '' };
      }
      return next;
    }
    case 'tel':
      return current.type === 'tel' ? { type: 'tel', number: current.number } : next;
    case 'mailto':
      return current.type === 'mailto' ? { type: 'mailto', email: current.email } : next;
    case 'webhook': {
      if (current.type === 'webhook') return current;
      if (current.type === 'custom_url' || current.type === 'line_friend') {
        return { ...next, url: current.url ?? '' };
      }
      return next;
    }
  }
}
