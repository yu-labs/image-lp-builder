/**
 * /api/my-links
 *
 * GET  -> list all MyLinks (newest first)
 * POST -> create a new MyLink
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { myLinkQueries, generateId } from '../../lib/db';
import { success, errors } from '../../lib/api';
import { validateUrlScheme } from '../../lib/url';

export const prerender = false;

const LABEL_MAX_LENGTH = 50;
const URL_MAX_LENGTH = 2048;
const MY_LINK_KINDS = ['url', 'tel', 'email'] as const;

export type MyLinkKind = (typeof MY_LINK_KINDS)[number];

export const GET: APIRoute = async ({ locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  try {
    const links = await myLinkQueries.list(env.DB, workspaceId);
    return success({ myLinks: links });
  } catch (err) {
    console.error('GET /api/my-links failed:', err);
    return errors.internalError('Failed to list MyLinks');
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('Request body must be valid JSON');
  }

  if (typeof body !== 'object' || body === null) {
    return errors.validationError('Request body must be a JSON object');
  }

  const { kind, label, url } = body as { kind?: unknown; label?: unknown; url?: unknown };
  const normalizedKind = normalizeMyLinkKind(kind);
  if (normalizedKind === false) {
    return errors.validationError('種類は URL・電話番号・メールのいずれかを指定してください', {
      field: 'kind',
    });
  }
  const labelError = validateLabel(label);
  const normalizedUrl = normalizeMyLinkUrl(url, normalizedKind ?? undefined);
  const urlError = validateUrl(normalizedUrl);
  if (labelError) return errors.validationError(labelError, { field: 'label' });
  if (urlError) return errors.validationError(urlError, { field: 'url' });

  try {
    const created = await myLinkQueries.create(env.DB, workspaceId, {
      id: generateId(),
      label: (label as string).trim(),
      url: normalizedUrl,
    });
    return success(created, 201);
  } catch (err) {
    console.error('POST /api/my-links failed:', err);
    return errors.internalError('Failed to create MyLink');
  }
};

export function validateLabel(value: unknown): string | null {
  if (typeof value !== 'string') return '`label` is required and must be a string';
  const trimmed = value.trim();
  if (trimmed.length === 0) return '`label` cannot be empty';
  if (trimmed.length > LABEL_MAX_LENGTH)
    return `\`label\` must be ${LABEL_MAX_LENGTH} characters or fewer`;
  return null;
}

export function validateUrl(value: unknown): string | null {
  if (typeof value !== 'string') return '`url` is required and must be a string';
  const trimmed = value.trim();
  if (trimmed.length === 0) return '`url` cannot be empty';
  if (trimmed.length > URL_MAX_LENGTH)
    return `\`url\` must be ${URL_MAX_LENGTH} characters or fewer`;
  if (/^tel:/i.test(trimmed)) {
    const phone = stripScheme(trimmed, 'tel');
    if (!/^[0-9+\-()]+$/.test(phone)) {
      return '電話番号は半角数字・+・-・()で入力してください';
    }
  }
  if (/^mailto:/i.test(trimmed)) {
    const email = stripScheme(trimmed, 'mailto');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return '正しいメールアドレスを入力してください';
    }
  }
  // Block `javascript:` / `data:` etc. so a stored MyLink can't smuggle
  // an XSS payload into a CTA href.
  return validateUrlScheme(trimmed, { kind: 'relative-or-absolute' });
}

export function normalizeMyLinkUrl(value: unknown, kind?: MyLinkKind): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (kind === 'tel') {
    const phone = stripScheme(trimmed, 'tel').replace(/\s+/g, '');
    return phone ? `tel:${phone}` : '';
  }
  if (kind === 'email') {
    const email = stripScheme(trimmed, 'mailto');
    return email ? `mailto:${email}` : '';
  }
  if (
    trimmed.length === 0 ||
    trimmed.startsWith('/') ||
    /^(https?|tel|mailto):/i.test(trimmed)
  ) {
    return trimmed;
  }
  if (looksLikeBareHost(trimmed)) return `https://${trimmed}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function normalizeMyLinkKind(value: unknown): MyLinkKind | null | false {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return false;
  return (MY_LINK_KINDS as readonly string[]).includes(value) ? (value as MyLinkKind) : false;
}

function stripScheme(value: string, scheme: 'tel' | 'mailto'): string {
  return value.replace(new RegExp(`^${scheme}:`, 'i'), '').trim();
}

function looksLikeBareHost(value: string): boolean {
  return /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|[^/\s:]+\.[^/\s:]+)(?::\d+)?(?:[/?#]|$)/i.test(
    value
  );
}
