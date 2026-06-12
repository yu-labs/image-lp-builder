/**
 * POST /api/lps/:id/republish
 *
 * Promote the working copy (current draft) to a fresh published
 * snapshot. Ends the previous active publication and opens a new
 * one so the public URL renders the latest edits. The public URL
 * only changes when this endpoint is called, not on every save.
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { hasPagePendingChanges, pageQueries } from '../../../../lib/db';
import { success, errors } from '../../../../lib/api';
import { pushHubConnectorSnapshot } from '../../../../lib/hub-connector-snapshot-push';

export const prerender = false;

export const POST: APIRoute = async ({ params, locals, url }) => {
  if (!env?.DB) {
    return errors.internalError('Database not configured');
  }

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }

  try {
    const existing = await pageQueries.findByIdWithDraft(
      env.DB,
      workspaceId,
      id
    );
    if (!existing) {
      return errors.notFound(`LP \`${id}\` not found`);
    }

    if (existing.status !== 'published') {
      return errors.conflict(
        `LP \`${id}\` must be published before it can be re-published`,
        { currentStatus: existing.status }
      );
    }

    if (!hasPagePendingChanges(existing)) {
      // Idempotent — nothing pending. Return the row as-is so the UI
      // can refresh state without surfacing an error.
      return success(existing);
    }

    const updated = await pageQueries.republish(env.DB, workspaceId, id);
    if (!updated) {
      return errors.internalError('Failed to re-publish LP');
    }

    const snapshotPush = await pushHubConnectorSnapshot({
      db: env.DB,
      workspaceId,
      lpId: id,
      requestUrl: url,
    });
    if (!snapshotPush.pushed && snapshotPush.reason !== 'not_configured') {
      console.warn('Hub Connector snapshot push skipped after republish', {
        lpId: id,
        reason: snapshotPush.reason,
        status: snapshotPush.status,
      });
    }

    return success(updated);
  } catch (err) {
    console.error(`POST /api/lps/${id}/republish failed:`, err);
    return errors.internalError('Failed to re-publish LP');
  }
};
