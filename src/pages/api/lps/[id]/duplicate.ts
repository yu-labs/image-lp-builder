/**
 * POST /api/lps/:id/duplicate
 *
 * Clone an LP into a fresh draft. Body: `{ slug?: string }`.
 *
 * Carries over the structural / visual side of the source LP
 * (sections + CTAs + promotions + max_width + background_color +
 * frame_style) and resets every operational field — see
 * pageQueries.duplicate for the exact split.
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pageQueries, generateId } from '../../../../lib/db';
import { success, errors } from '../../../../lib/api';
import {
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
} from '../../../../lib/slugs';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }

  try {
    const source = await pageQueries.findById(env.DB, workspaceId, id);
    if (!source) return errors.notFound(`複製元のLPが見つかりませんでした`);
    return success({
      slug: await nextDuplicateSlug(env.DB, source.slug),
    });
  } catch (err) {
    console.error(`GET /api/lps/${id}/duplicate failed:`, err);
    return errors.internalError('Failed to suggest duplicate LP slug');
  }
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('リクエストの形式が不正です(JSON 形式を指定してください)');
  }

  if (typeof body !== 'object' || body === null) {
    return errors.validationError('リクエストの形式が不正です(オブジェクトを指定してください)');
  }

  try {
    const source = await pageQueries.findById(env.DB, workspaceId, id);
    if (!source) return errors.notFound(`複製元のLPが見つかりませんでした`);
    const rawSlug = (body as { slug?: unknown }).slug;
    const slug =
      typeof rawSlug === 'string' && rawSlug.trim().length > 0
        ? rawSlug.trim().toLowerCase()
        : await nextDuplicateSlug(env.DB, source.slug);

    const slugError = validateDuplicateSlug(slug);
    if (slugError) return slugError;

    if (await pageQueries.existsBySlug(env.DB, slug)) {
      return errors.validationError(
        `「${slug}」というURL末尾は既に使われています。別の名前を入力してください`,
        { field: 'slug' }
      );
    }

    const duplicated = await pageQueries.duplicate(env.DB, workspaceId, id, {
      id: generateId(),
      slug,
    });
    if (!duplicated) {
      return errors.internalError('Failed to duplicate LP');
    }

    return success(duplicated, 201);
  } catch (err) {
    console.error(`POST /api/lps/${id}/duplicate failed:`, err);
    return errors.internalError('Failed to duplicate LP');
  }
};

function validateDuplicateSlug(slug: string): Response | null {
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) {
    return errors.validationError(
      `URL末尾(slug)は ${SLUG_MIN_LENGTH}〜${SLUG_MAX_LENGTH} 文字で入力してください`,
      { field: 'slug' }
    );
  }

  if (!SLUG_PATTERN.test(slug)) {
    return errors.validationError(
      'URL末尾(slug)は半角英数字とハイフンのみ使えます(先頭・末尾はハイフン不可)',
      { field: 'slug' }
    );
  }

  if (RESERVED_SLUGS.has(slug)) {
    return errors.validationError(
      `「${slug}」はシステムで使うURLのため選べません。別のURL末尾にしてください`,
      { field: 'slug' }
    );
  }

  return null;
}

async function nextDuplicateSlug(
  db: D1Database,
  sourceSlug: string
): Promise<string> {
  const base = truncateSlugBase(sourceSlug, '-copy');
  const first = `${base}-copy`;
  const rows = await db
    .prepare(`SELECT slug FROM pages WHERE slug = ? OR slug LIKE ?`)
    .bind(first, `${first}%`)
    .all<{ slug: string }>();
  const used = new Set(
    (rows.results ?? [])
      .map((row) => row.slug)
      .filter((slug): slug is string => typeof slug === 'string')
  );

  if (!used.has(first) && !RESERVED_SLUGS.has(first)) return first;
  for (let i = 2; i < 10000; i += 1) {
    const suffix = `-copy${i}`;
    const candidate = `${truncateSlugBase(sourceSlug, suffix)}${suffix}`;
    if (!used.has(candidate) && !RESERVED_SLUGS.has(candidate)) {
      return candidate;
    }
  }
  const suffix = `-copy${Date.now()}`;
  return `${truncateSlugBase(sourceSlug, suffix)}${suffix}`;
}

function truncateSlugBase(sourceSlug: string, suffix: string): string {
  const maxBaseLength = Math.max(1, SLUG_MAX_LENGTH - suffix.length);
  const trimmed = sourceSlug.slice(0, maxBaseLength).replace(/-+$/g, '');
  return trimmed || 'lp';
}
