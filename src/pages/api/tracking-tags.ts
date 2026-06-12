/**
 * /api/tracking-tags
 *
 * GET -> read the singleton tracking_tags row (defaults applied if
 *        none exists yet)
 * PUT -> upsert tracking IDs + custom head HTML
 *
 * Authentication is enforced by middleware. Tracking IDs are validated
 * by vendor format so malformed tags are not rendered into public LPs.
 *
 * Security note: customHead is sanitized but still allows tracking
 * `<script>` tags. Pasted scripts share an origin with the admin
 * API while the admin is logged in — see README "Security
 * considerations".
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { trackingTagsQueries } from '../../lib/db';
import { success, errors } from '../../lib/api';
import { sanitizeCustomHead } from '../../lib/sanitize-head';

export const prerender = false;

const ID_MAX = 100;
const HTML_MAX = 8000;
const ALLOWED_CUSTOM_HEAD_TAG_RE =
  /<(script|noscript|style|link|meta)\b[\s\S]*?>/i;
const DISALLOWED_CUSTOM_HEAD_TAG_RE = /<(img|iframe)\b[\s\S]*?>/i;
const CUSTOM_HEAD_CLOSING_TAGS = ['script', 'noscript', 'style'];

type TrackingInputKey = 'gtmId' | 'ga4Id' | 'clarityId' | 'metaPixelId';

const TRACKING_ID_VALIDATORS: Record<
  TrackingInputKey,
  {
    normalize: (value: string) => string;
    pattern: RegExp;
    message: string;
  }
> = {
  gtmId: {
    normalize: (value) => value.toUpperCase(),
    pattern: /^GTM-[A-Z0-9]+$/,
    message: 'GTM IDは GTM-XXXXXXX の形式で入力してください',
  },
  ga4Id: {
    normalize: (value) => value.toUpperCase(),
    pattern: /^G-[A-Z0-9]+$/,
    message: 'GA4 IDは G-XXXXXXX の形式で入力してください',
  },
  clarityId: {
    normalize: (value) => value,
    pattern: /^[A-Za-z0-9_-]{6,64}$/,
    message: 'Clarity IDは英数字のプロジェクトIDを入力してください',
  },
  metaPixelId: {
    normalize: (value) => value,
    pattern: /^\d{5,30}$/,
    message: 'Meta Pixel IDは半角数字で入力してください',
  },
};

interface MetaJson {
  customHead?: string;
}

function readMeta(metaRaw: string | null): MetaJson {
  if (!metaRaw) return {};
  try {
    const parsed = JSON.parse(metaRaw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as MetaJson;
  } catch {
    /* fall through */
  }
  return {};
}

function validateCustomHead(html: string): string | null {
  const trimmed = html.trim();
  if (!trimmed) return null;
  if (DISALLOWED_CUSTOM_HEAD_TAG_RE.test(trimmed)) {
    return 'カスタムHTMLは<head>内に出力されるため、<img> や <iframe> は使えません';
  }
  if (!ALLOWED_CUSTOM_HEAD_TAG_RE.test(trimmed)) {
    return 'カスタムHTMLは <script>、<meta>、<link> など<head>用のHTMLタグを入力してください';
  }
  for (const tag of CUSTOM_HEAD_CLOSING_TAGS) {
    const openCount = trimmed.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))?.length ?? 0;
    const closeCount = trimmed.match(new RegExp(`</${tag}>`, 'gi'))?.length ?? 0;
    if (openCount !== closeCount) {
      return `<${tag}> タグは閉じタグ </${tag}> まで入力してください`;
    }
  }
  return null;
}

export const GET: APIRoute = async ({ locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  try {
    const row = await trackingTagsQueries.get(env.DB, locals.workspace_id);
    if (!row) {
      return success({
        gtmId: null,
        ga4Id: null,
        clarityId: null,
        metaPixelId: null,
        customHead: '',
      });
    }
    const meta = readMeta(row.meta);
    return success({
      gtmId: row.gtm_id,
      ga4Id: row.ga4_id,
      clarityId: row.clarity_id,
      metaPixelId: row.meta_pixel_id,
      customHead: meta.customHead ?? '',
    });
  } catch (err) {
    console.error('GET /api/tracking-tags failed:', err);
    return errors.internalError('Failed to read tracking tags');
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('Request body must be valid JSON');
  }
  if (typeof body !== 'object' || body === null) {
    return errors.validationError('Request body must be a JSON object');
  }

  const input = body as Record<string, unknown>;

  function pickId(key: TrackingInputKey): string | null | undefined {
    if (!(key in input)) return undefined;
    const value = input[key];
    if (value === null || value === '') return null;
    if (typeof value !== 'string')
      throw new Error(`\`${key}\` must be a string or null`);
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (trimmed.length > ID_MAX) throw new Error(`\`${key}\` is too long`);
    const validator = TRACKING_ID_VALIDATORS[key];
    const normalized = validator.normalize(trimmed);
    if (!validator.pattern.test(normalized)) {
      throw new Error(validator.message);
    }
    return normalized;
  }

  let patch: {
    gtm_id?: string | null;
    ga4_id?: string | null;
    clarity_id?: string | null;
    meta_pixel_id?: string | null;
    meta?: string;
  };
  try {
    patch = {};
    const gtm = pickId('gtmId');
    const ga4 = pickId('ga4Id');
    const clarity = pickId('clarityId');
    const metaPixel = pickId('metaPixelId');
    if (gtm !== undefined) patch.gtm_id = gtm;
    if (ga4 !== undefined) patch.ga4_id = ga4;
    if (clarity !== undefined) patch.clarity_id = clarity;
    if (metaPixel !== undefined) patch.meta_pixel_id = metaPixel;

    if ('customHead' in input) {
      const value = input.customHead;
      if (value !== null && typeof value !== 'string') {
        throw new Error('`customHead` must be a string or null');
      }
      const html = value === null ? '' : value;
      if (html.length > HTML_MAX) {
        throw new Error(`\`customHead\` must be ${HTML_MAX} characters or fewer`);
      }
      const customHeadError = validateCustomHead(html);
      if (customHeadError) throw new Error(customHeadError);
      // Sanitize before storage; PublicLayout sanitizes again at
      // render time as defense-in-depth.
      const safeHtml = sanitizeCustomHead(html);
      const existing = await trackingTagsQueries.get(env.DB, locals.workspace_id);
      const meta = readMeta(existing?.meta ?? null);
      meta.customHead = safeHtml;
      patch.meta = JSON.stringify(meta);
    }
  } catch (err) {
    return errors.validationError(
      err instanceof Error ? err.message : String(err)
    );
  }

  try {
    const updated = await trackingTagsQueries.upsert(env.DB, locals.workspace_id, patch);
    const meta = readMeta(updated.meta);
    return success({
      gtmId: updated.gtm_id,
      ga4Id: updated.ga4_id,
      clarityId: updated.clarity_id,
      metaPixelId: updated.meta_pixel_id,
      customHead: meta.customHead ?? '',
    });
  } catch (err) {
    console.error('PUT /api/tracking-tags failed:', err);
    return errors.internalError('Failed to update tracking tags');
  }
};
