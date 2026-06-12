/**
 * /api/lps
 *
 * GET  -> list LPs (paginated)
 * POST -> create a new LP as a draft
 *
 * Authentication is enforced by middleware. Both methods require an
 * authenticated user (owner or editor).
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pageQueries, generateId } from '../../lib/db';
import { success, errors } from '../../lib/api';
import {
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
} from '../../lib/slugs';

export const prerender = false;
const TITLE_MAX_LENGTH = 80;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePositiveInt(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export const GET: APIRoute = async ({ url, locals }) => {
  if (!env?.DB) {
    return errors.internalError('Database not configured');
  }

  const workspaceId = locals.workspace_id;
  const limit = Math.min(
    parsePositiveInt(url.searchParams.get('limit'), DEFAULT_LIMIT),
    MAX_LIMIT
  );
  const offset = parsePositiveInt(url.searchParams.get('offset'), 0);

  try {
    const [pages, total] = await Promise.all([
      pageQueries.listAll(env.DB, workspaceId, { limit, offset }),
      pageQueries.countAll(env.DB, workspaceId),
    ]);

    return success({
      pages,
      pagination: { total, limit, offset },
    });
  } catch (err) {
    console.error('GET /api/lps failed:', err);
    return errors.internalError('Failed to list LPs');
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!env?.DB) {
    return errors.internalError('Database not configured');
  }

  const workspaceId = locals.workspace_id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('リクエストの形式が不正です(JSON 形式を指定してください)');
  }

  if (typeof body !== 'object' || body === null) {
    return errors.validationError('リクエストの形式が不正です(オブジェクトを指定してください)');
  }

  const rawTitle = (body as { title?: unknown }).title;
  if (typeof rawTitle !== 'string') {
    return errors.validationError('LP名を入力してください', {
      field: 'title',
    });
  }

  const title = rawTitle.trim();
  if (title.length === 0) {
    return errors.validationError('LP名を入力してください', {
      field: 'title',
    });
  }
  if (title.length > TITLE_MAX_LENGTH) {
    return errors.validationError(
      `LP名は ${TITLE_MAX_LENGTH} 文字以下で入力してください`,
      { field: 'title' }
    );
  }

  const rawSlug = (body as { slug?: unknown }).slug;
  let slug: string | null = null;
  if (rawSlug !== undefined && rawSlug !== null) {
    if (typeof rawSlug !== 'string') {
      return errors.validationError('URL末尾(slug)は文字列で指定してください', {
        field: 'slug',
      });
    }

    const requestedSlug = rawSlug.trim().toLowerCase();
    if (requestedSlug.length > 0) {
      if (
        requestedSlug.length < SLUG_MIN_LENGTH ||
        requestedSlug.length > SLUG_MAX_LENGTH
      ) {
        return errors.validationError(
          `URL末尾(slug)は ${SLUG_MIN_LENGTH}〜${SLUG_MAX_LENGTH} 文字で入力してください`,
          { field: 'slug' }
        );
      }

      if (!SLUG_PATTERN.test(requestedSlug)) {
        return errors.validationError(
          'URL末尾(slug)は半角英数字とハイフンのみ使えます(先頭・末尾はハイフン不可)',
          { field: 'slug' }
        );
      }

      if (RESERVED_SLUGS.has(requestedSlug)) {
        return errors.validationError(
          `「${requestedSlug}」はシステムで使うURLのため選べません。別のURL末尾にしてください`,
          { field: 'slug' }
        );
      }

      slug = requestedSlug;
    }
  }

  try {
    if (slug !== null && (await pageQueries.existsBySlug(env.DB, slug))) {
      return errors.validationError(
        `「${slug}」というURL末尾は既に使われています。別の名前を入力してください`,
        { field: 'slug' }
      );
    }

    const finalSlug = slug ?? (await generateAutoSlug(env.DB));

    const created = await pageQueries.create(env.DB, workspaceId, {
      id: generateId(),
      slug: finalSlug,
      title,
    });

    return success(created, 201);
  } catch (err) {
    console.error('POST /api/lps failed:', err);
    return errors.internalError('Failed to create LP');
  }
};

async function generateAutoSlug(db: D1Database): Promise<string> {
  for (let i = 0; i < 10; i += 1) {
    const candidate = `lp-${generateId().replace(/-/g, '').slice(0, 10)}`;
    if (!(await pageQueries.existsBySlug(db, candidate))) {
      return candidate;
    }
  }
  throw new Error('Failed to generate unique LP slug');
}
