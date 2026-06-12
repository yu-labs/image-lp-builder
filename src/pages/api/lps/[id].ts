/**
 * /api/lps/:id
 *
 * GET    -> retrieve a single LP (any status, with parsed content)
 * PUT    -> replace the LP's content JSON
 * DELETE -> soft-delete (move to trash)
 *
 * Authentication is enforced by middleware. All methods require an
 * authenticated user (owner or editor).
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { hasPagePendingChanges, pageQueries } from '../../../lib/db';
import { parseContent, validateContentInput } from '../../../lib/content';
import { success, errors } from '../../../lib/api';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) {
    return errors.internalError('Database not configured');
  }

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }

  try {
    const page = await pageQueries.findByIdWithDraft(
      env.DB,
      workspaceId,
      id
    );
    if (!page) {
      return errors.notFound(`LP \`${id}\` not found`);
    }

    return success({
      ...page,
      content: parseContent(page.content),
      hasPendingChanges: hasPagePendingChanges(page),
    });
  } catch (err) {
    console.error(`GET /api/lps/${id} failed:`, err);
    return errors.internalError('Failed to retrieve LP');
  }
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!env?.DB) {
    return errors.internalError('Database not configured');
  }

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP の ID が指定されていません', { field: 'id' });
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

  const rawContent = (body as { content?: unknown }).content;
  if (rawContent === undefined) {
    return errors.validationError('LP の内容(content)が指定されていません', {
      field: 'content',
    });
  }

  const validation = validateContentInput(rawContent);
  if (!validation.ok) {
    // 詳細メッセージは validation.errors に並んでる(各 validator が
    // 日本語化済み)。トップメッセージにも 1 本目を露出させて、
    // 管理画面のエラー表示で内容が見えるようにする。
    const summary =
      validation.errors[0]
        ? `保存できません: ${validation.errors[0]}`
        : 'LP の内容が不正です';
    return errors.validationError(summary, {
      issues: validation.errors,
    });
  }

  try {
    const existing = await pageQueries.findById(env.DB, workspaceId, id);
    if (!existing) {
      return errors.notFound(`LP \`${id}\` not found`);
    }

    await pageQueries.updateContent(
      env.DB,
      workspaceId,
      id,
      JSON.stringify(validation.content)
    );

    const updated = await pageQueries.findByIdWithDraft(
      env.DB,
      workspaceId,
      id
    );
    if (!updated) {
      return errors.internalError('Failed to update LP');
    }

    return success({
      ...updated,
      content: parseContent(updated.content),
    });
  } catch (err) {
    console.error(`PUT /api/lps/${id} failed:`, err);
    return errors.internalError('Failed to update LP');
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) {
    return errors.internalError('Database not configured');
  }

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }

  try {
    const existing = await pageQueries.findById(env.DB, workspaceId, id);
    if (!existing) {
      return errors.notFound(`LP \`${id}\` not found`);
    }
    if (existing.status === 'trash') {
      return errors.conflict(`LP \`${id}\` is already in trash`, {
        currentStatus: existing.status,
      });
    }

    const updated = await pageQueries.softDelete(env.DB, workspaceId, id);
    if (!updated) {
      return errors.internalError('Failed to delete LP');
    }

    return success(updated);
  } catch (err) {
    console.error(`DELETE /api/lps/${id} failed:`, err);
    return errors.internalError('Failed to delete LP');
  }
};
