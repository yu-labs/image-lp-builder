/**
 * PATCH /api/lps/:id/settings
 *
 * Updates LP-level settings. The body is a partial: only the fields present
 * are touched.
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pageQueries, publicationsQueries } from '../../../../lib/db';
import { success, errors } from '../../../../lib/api';
import { hashPassword } from '../../../../lib/password';
import {
  RESERVED_SLUGS,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
} from '../../../../lib/slugs';

export const prerender = false;

const MIN_WIDTH = 320;
const MAX_WIDTH = 1920;
const DOMAIN_MAX_LENGTH = 253;
const TITLE_MAX_LENGTH = 80;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SCHEDULE_PAST_DATE_ERROR =
  '本日より前の日付は選択できません';

export const PATCH: APIRoute = async ({ params, request, locals }) => {
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

  const {
    title,
    slug,
    maxWidth,
    customDomain,
    publishAt,
    unpublishAt,
    password,
    backgroundColor,
    frameStyle,
  } = body as {
    title?: unknown;
    slug?: unknown;
    maxWidth?: unknown;
    customDomain?: unknown;
    publishAt?: unknown;
    unpublishAt?: unknown;
    password?: unknown;
    backgroundColor?: unknown;
    frameStyle?: unknown;
  };

  const patch: {
    title?: string;
    slug?: string;
    maxWidth?: number;
    customDomain?: string | null;
    publishAt?: string | null;
    unpublishAt?: string | null;
    passwordHash?: string | null;
    backgroundColor?: string | null;
    frameStyle?: 'line' | 'shadow' | 'none' | null;
    metaJson?: string | null;
  } = {};

  if (title !== undefined) {
    if (typeof title !== 'string') {
      return errors.validationError('LP名は文字列で指定してください', {
        field: 'title',
      });
    }
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return errors.validationError('LP名を入力してください', {
        field: 'title',
      });
    }
    if (trimmed.length > TITLE_MAX_LENGTH) {
      return errors.validationError(
        `LP名は ${TITLE_MAX_LENGTH} 文字以下で入力してください`,
        { field: 'title' }
      );
    }
    patch.title = trimmed;
  }

  if (slug !== undefined) {
    if (typeof slug !== 'string') {
      return errors.validationError('URL末尾(slug)は文字列で指定してください', {
        field: 'slug',
      });
    }
    const normalized = slug.trim().toLowerCase();
    if (
      normalized.length < SLUG_MIN_LENGTH ||
      normalized.length > SLUG_MAX_LENGTH
    ) {
      return errors.validationError(
        `URL末尾(slug)は ${SLUG_MIN_LENGTH}〜${SLUG_MAX_LENGTH} 文字で入力してください`,
        { field: 'slug' }
      );
    }
    if (!SLUG_PATTERN.test(normalized)) {
      return errors.validationError(
        'URL末尾(slug)は半角英数字とハイフンのみ使えます(先頭・末尾はハイフン不可)',
        { field: 'slug' }
      );
    }
    if (RESERVED_SLUGS.has(normalized)) {
      return errors.validationError(
        `「${normalized}」はシステムで使うURLのため選べません。別のURL末尾にしてください`,
        { field: 'slug' }
      );
    }
    patch.slug = normalized;
  }

  if (maxWidth !== undefined) {
    if (
      typeof maxWidth !== 'number' ||
      !Number.isFinite(maxWidth) ||
      maxWidth < MIN_WIDTH ||
      maxWidth > MAX_WIDTH
    ) {
      return errors.validationError(
        `LP最大幅は ${MIN_WIDTH}〜${MAX_WIDTH} px の範囲で指定してください`,
        { field: 'maxWidth' }
      );
    }
    patch.maxWidth = Math.round(maxWidth);
  }

  if (publishAt !== undefined) {
    if (publishAt === null || publishAt === '') {
      patch.publishAt = null;
    } else if (typeof publishAt !== 'string') {
      return errors.validationError('公開開始日時の形式が不正です', {
        field: 'publishAt',
      });
    } else if (Number.isNaN(new Date(publishAt).getTime())) {
      return errors.validationError('公開開始日時として認識できません', {
        field: 'publishAt',
      });
    } else if (isBeforeTodayInJst(publishAt)) {
      return errors.validationError(SCHEDULE_PAST_DATE_ERROR, {
        field: 'publishAt',
      });
    } else {
      patch.publishAt = publishAt;
    }
  }

  if (unpublishAt !== undefined) {
    if (unpublishAt === null || unpublishAt === '') {
      patch.unpublishAt = null;
    } else if (typeof unpublishAt !== 'string') {
      return errors.validationError('公開停止日時の形式が不正です', {
        field: 'unpublishAt',
      });
    } else if (Number.isNaN(new Date(unpublishAt).getTime())) {
      return errors.validationError('公開停止日時として認識できません', {
        field: 'unpublishAt',
      });
    } else if (isBeforeTodayInJst(unpublishAt)) {
      return errors.validationError(SCHEDULE_PAST_DATE_ERROR, {
        field: 'unpublishAt',
      });
    } else {
      patch.unpublishAt = unpublishAt;
    }
  }

  if (password !== undefined) {
    if (password === null || password === '') {
      patch.passwordHash = null;
    } else if (typeof password !== 'string') {
      return errors.validationError('パスワードの形式が不正です', {
        field: 'password',
      });
    } else if (password.length < 4) {
      return errors.validationError('パスワードは 4 文字以上で入力してください', {
        field: 'password',
      });
    } else if (password.length > 16) {
      return errors.validationError('パスワードは 16 文字以下で入力してください', {
        field: 'password',
      });
    } else if (!/^[\x21-\x7e]+$/.test(password)) {
      // Restrict to printable ASCII (no spaces, no full-width chars)
      // so the password copies/pastes cleanly between LINE, email,
      // and any other channel the operator uses to share it.
      return errors.validationError(
        'パスワードは半角英数字と記号のみ使用できます(全角・スペース不可)',
        { field: 'password' },
      );
    } else {
      patch.passwordHash = await hashPassword(password);
    }
  }

  if (backgroundColor !== undefined) {
    if (backgroundColor === null || backgroundColor === '') {
      patch.backgroundColor = null;
    } else if (typeof backgroundColor !== 'string') {
      return errors.validationError(
        '背景色は16進数のカラーコード(例: #f5f7fa)で指定してください',
        { field: 'backgroundColor' }
      );
    } else {
      const trimmed = backgroundColor.trim().toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(trimmed)) {
        return errors.validationError(
          '背景色は 6 桁の16進数カラーコード(例: #f5f7fa)で指定してください',
          { field: 'backgroundColor' }
        );
      }
      patch.backgroundColor = trimmed;
    }
  }

  if (frameStyle !== undefined) {
    if (frameStyle === null || frameStyle === '' || frameStyle === 'none') {
      patch.frameStyle = null;
    } else if (frameStyle === 'line' || frameStyle === 'shadow') {
      patch.frameStyle = frameStyle;
    } else {
      return errors.validationError(
        'コンテンツ装飾は「ライン」「ドロップシャドウ」「なし」のいずれかを指定してください',
        { field: 'frameStyle' }
      );
    }
  }

  if (customDomain !== undefined) {
    if (customDomain === null || customDomain === '') {
      patch.customDomain = null;
    } else if (typeof customDomain !== 'string') {
      return errors.validationError('カスタムドメインの形式が不正です', {
        field: 'customDomain',
      });
    } else {
      const trimmed = customDomain.trim().toLowerCase();
      if (trimmed.length > DOMAIN_MAX_LENGTH) {
        return errors.validationError(
          `カスタムドメインは ${DOMAIN_MAX_LENGTH} 文字以下で入力してください`,
          { field: 'customDomain' }
        );
      }
      // Basic shape check — leave deeper validation to the DNS layer
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(trimmed)) {
        return errors.validationError(
          'カスタムドメインの形式が正しくありません(例: example.com)',
          { field: 'customDomain' }
        );
      }
      patch.customDomain = trimmed;
    }
  }

  try {
    const touchesRenderSettings =
      maxWidth !== undefined ||
      backgroundColor !== undefined ||
      frameStyle !== undefined;
    const needsExistingPage =
      touchesRenderSettings ||
      publishAt !== undefined ||
      unpublishAt !== undefined;
    const existing = needsExistingPage
      ? await pageQueries.findById(env.DB, workspaceId, id)
      : null;
    if (needsExistingPage && !existing) {
      return errors.notFound(`LP \`${id}\` not found`);
    }

    if (publishAt !== undefined || unpublishAt !== undefined) {
      const effectivePublishAt =
        patch.publishAt !== undefined
          ? patch.publishAt
          : existing?.publish_at ?? null;
      const effectiveUnpublishAt =
        patch.unpublishAt !== undefined
          ? patch.unpublishAt
          : existing?.unpublish_at ?? null;

      if (
        effectivePublishAt &&
        effectiveUnpublishAt &&
        new Date(effectivePublishAt).getTime() >=
          new Date(effectiveUnpublishAt).getTime()
      ) {
        return errors.validationError(
          '公開開始日時は公開停止日時より前にしてください',
          { field: 'publishAt' }
        );
      }
    }

    if (patch.slug) {
      const conflict = await pageQueries.existsBySlugExcept(
        env.DB,
        patch.slug,
        id
      );
      if (conflict) {
        return errors.validationError(
          `「${patch.slug}」というURL末尾は既に使われています。別の名前を入力してください`,
          { field: 'slug' }
        );
      }
    }

    if (touchesRenderSettings && existing?.status === 'published') {
      await publicationsQueries.ensureRenderSettingsSnapshot(
        env.DB,
        workspaceId,
        existing
      );
    }

    const updated = await pageQueries.updateSettings(
      env.DB,
      workspaceId,
      id,
      patch
    );
    if (!updated) return errors.notFound(`LP \`${id}\` not found`);
    return success(updated);
  } catch (err) {
    console.error(`PATCH /api/lps/${id}/settings failed:`, err);
    return errors.internalError('Failed to update settings');
  }
};

function isBeforeTodayInJst(iso: string): boolean {
  return new Date(iso).getTime() < startOfTodayInJstMs();
}

function startOfTodayInJstMs(): number {
  const nowInJst = new Date(Date.now() + JST_OFFSET_MS);
  return (
    Date.UTC(
      nowInJst.getUTCFullYear(),
      nowInJst.getUTCMonth(),
      nowInJst.getUTCDate()
    ) - JST_OFFSET_MS
  );
}
