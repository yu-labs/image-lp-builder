/**
 * POST /api/hub/imports/:id/improvement-draft
 *
 * Read a Connector-produced improvement_draft JSON and turn it into a
 * Builder draft. This never mutates the currently published LP and
 * never publishes automatically. Builder only applies explicit
 * section_id / cta_id based instructions; analysis and report logic
 * stays in Connector.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { errors, success } from '../../../../../lib/api';
import { parseContent, validateContentInput } from '../../../../../lib/content';
import { pageQueries } from '../../../../../lib/db';
import {
  applyImprovementDraft,
  parseImprovementDraftInput,
  validateImprovementDraftFreshness,
} from '../../../../../lib/improvement-draft';
import { requireHubConnectorAuth } from '../../../../../lib/hub-connector-auth';

export const prerender = false;

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

    const draftParse = parseImprovementDraftInput(body, id);
    if (!draftParse.ok) {
      return errors.validationError('Invalid improvement draft', {
        issues: draftParse.errors,
      });
    }

    const page = await pageQueries.findByIdWithDraft(env.DB, workspaceId, id);
    if (!page) return errors.notFound(`LP \`${id}\` not found`);
    if (page.status === 'trash') {
      return errors.conflict(
        `LP \`${id}\` is in trash; restore before importing`,
        { currentStatus: page.status }
      );
    }
    if (!page.live_content || !page.latest_publication_id) {
      return errors.conflict(
        `LP \`${id}\` has no published snapshot to improve`,
        {
          latest_publication_id: page.latest_publication_id,
          published_version_id: page.published_version_id,
        }
      );
    }

    const freshness = validateImprovementDraftFreshness(
      draftParse.draft,
      page.latest_publication_id
    );
    if (!freshness.ok) {
      const hasMismatch = freshness.errors.some(
        (issue) => issue.code === 'SOURCE_PUBLICATION_MISMATCH'
      );
      const payload = {
        issues: freshness.errors,
        improvement_draft: {
          source_snapshot_id: draftParse.draft.source_snapshot_id,
          source_publication_id: draftParse.draft.source_publication_id,
          target_lp_id: draftParse.draft.target_lp_id,
        },
      };
      if (hasMismatch) {
        return errors.conflict(
          'Improvement draft source_publication_id does not match the current published LP',
          payload
        );
      }
      return errors.validationError(
        'Improvement draft source_publication_id is required',
        payload
      );
    }

    const applied = applyImprovementDraft(
      parseContent(page.live_content),
      draftParse.draft,
      {
        targetLpId: id,
        currentPublicationId: page.latest_publication_id,
      }
    );

    if (applied.applied_changes.length === 0) {
      return errors.validationError(
        'No applicable improvement_draft changes were applied',
        {
          improvement_draft: {
            source_snapshot_id: applied.source_snapshot_id,
            source_publication_id: applied.source_publication_id,
          },
          warnings: applied.warnings,
          skipped_changes: applied.skipped_changes,
        }
      );
    }

    const validation = validateContentInput(applied.content);
    if (!validation.ok) {
      return errors.validationError('Improvement draft produced invalid LP content', {
        issues: validation.errors,
        warnings: applied.warnings,
        applied_changes: applied.applied_changes,
        skipped_changes: applied.skipped_changes,
      });
    }

    const result = await pageQueries.importHubConnectorDraft(
      env.DB,
      workspaceId,
      id,
      JSON.stringify(validation.content)
    );
    if (!result) {
      return errors.internalError('Failed to create draft from improvement_draft');
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
        improvement_draft: {
          source_snapshot_id: applied.source_snapshot_id,
          source_publication_id: applied.source_publication_id,
          title: draftParse.draft.title,
          warnings: applied.warnings,
          applied_changes: applied.applied_changes,
          skipped_changes: applied.skipped_changes,
        },
      },
      201
    );
  } catch (err) {
    console.error(`POST /api/hub/imports/${id}/improvement-draft failed:`, err);
    return errors.internalError('Failed to import improvement draft');
  }
};
