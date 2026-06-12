/**
 * POST /api/hub/imports/:id
 *
 * Bring in a new draft for an existing LP from the Hub Connector.
 * Body: `{ content: PageContent }` — same shape `PUT /api/lps/:id`
 * accepts.
 *
 * Effect:
 *   - Validates the supplied content against `validateContentInput`.
 *   - Archives any existing draft row(s) on the LP.
 *   - Inserts a fresh `page_versions` row with `status='draft'` and
 *     `source='hub_connector'`.
 *   - Re-points `pages.current_draft_version_id` at the new draft.
 *   - Leaves `published_version_id` and `latest_publication_id`
 *     untouched — the public LP never changes from this endpoint.
 *
 * Safety: this endpoint is intentionally carved out of admin-session
 * middleware and is protected by the Hub Connector server token.
 * The workspace's `hub_connector` row must exist, carry a configured
 * token hash, be `enabled = true`, and have `status = 'active'`.
 *
 * `server_token_encrypted` is used only inside auth verification and
 * is never returned here.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { pageQueries } from '../../../../lib/db';
import { validateContentInput } from '../../../../lib/content';
import { success, errors } from '../../../../lib/api';
import { requireHubConnectorAuth } from '../../../../lib/hub-connector-auth';

export const prerender = false;

/**
 * Cap on the request body size. The PageContent JSON is mostly URLs
 * and short strings; 2 MB is well above the realistic upper bound
 * for a single LP and still tight enough to short-circuit obvious
 * abuse before we run validation. Aligns with the upload paths that
 * reject oversized requests early.
 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }

  const declaredLengthRaw = request.headers.get('content-length');
  if (declaredLengthRaw !== null) {
    const declaredLength = Number.parseInt(declaredLengthRaw, 10);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return errors.validationError(
        `Request body exceeds the ${MAX_BODY_BYTES}-byte limit`
      );
    }
  }

  try {
    const authError = await requireHubConnectorAuth(
      env.DB,
      workspaceId,
      request
    );
    if (authError) return authError;

    const rawBody = await request.text();
    // Enforce the cap on the actual decoded UTF-8 byte length so the
    // limit holds even when Content-Length is missing or understated
    // (chunked transfers, misbehaving clients).
    const actualLength = new TextEncoder().encode(rawBody).byteLength;
    if (actualLength > MAX_BODY_BYTES) {
      return errors.validationError(
        `Request body exceeds the ${MAX_BODY_BYTES}-byte limit`
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return errors.validationError('Request body must be valid JSON');
    }
    if (typeof body !== 'object' || body === null) {
      return errors.validationError('Request body must be a JSON object');
    }

    const rawContent = (body as { content?: unknown }).content;
    if (rawContent === undefined) {
      return errors.validationError('`content` is required', {
        field: 'content',
      });
    }

    const validation = validateContentInput(rawContent);
    if (!validation.ok) {
      return errors.validationError('Invalid LP content', {
        field: 'content',
        issues: validation.errors,
      });
    }

    const page = await pageQueries.findById(env.DB, workspaceId, id);
    if (!page) return errors.notFound(`LP \`${id}\` not found`);
    if (page.status === 'trash') {
      return errors.conflict(
        `LP \`${id}\` is in trash; restore before importing`,
        { currentStatus: page.status }
      );
    }

    const result = await pageQueries.importHubConnectorDraft(
      env.DB,
      workspaceId,
      id,
      JSON.stringify(validation.content)
    );
    if (!result) {
      return errors.internalError('Failed to create draft from import');
    }

    return success(
      {
        page: {
          id: result.page.id,
          slug: result.page.slug,
          status: result.page.status,
          current_draft_version_id: result.page.current_draft_version_id,
          published_version_id: result.page.published_version_id,
          latest_publication_id: result.page.latest_publication_id,
        },
        draft_version: {
          id: result.draftVersion.id,
          page_id: result.draftVersion.page_id,
          version_number: result.draftVersion.version_number,
          status: result.draftVersion.status,
          source: result.draftVersion.source,
          base_version_id: result.draftVersion.base_version_id,
          base_publication_id: result.draftVersion.base_publication_id,
          created_at: result.draftVersion.created_at,
          updated_at: result.draftVersion.updated_at,
        },
      },
      201
    );
  } catch (err) {
    console.error(`POST /api/hub/imports/${id} failed:`, err);
    return errors.internalError('Failed to import draft');
  }
};
