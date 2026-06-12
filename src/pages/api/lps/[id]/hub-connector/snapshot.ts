/**
 * POST /api/lps/:id/hub-connector/snapshot
 *
 * Manually pushes the LP's currently-published export payload to the
 * configured Hub Connector. This is useful for already-published LPs
 * where no publish/republish event will fire.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { success, errors } from '../../../../../lib/api';
import { pushHubConnectorSnapshot } from '../../../../../lib/hub-connector-snapshot-push';

export const prerender = false;

export const POST: APIRoute = async ({ params, locals, url }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }

  try {
    const result = await pushHubConnectorSnapshot({
      db: env.DB,
      workspaceId,
      lpId: id,
      requestUrl: url,
    });
    if (!result.pushed) {
      return errors.conflict('Hub Connector snapshot was not pushed', {
        reason: result.reason,
        ...(result.status ? { status: result.status } : {}),
      });
    }

    return success({
      pushed: true,
      status: result.status,
    });
  } catch (err) {
    console.error(`POST /api/lps/${id}/hub-connector/snapshot failed:`, err);
    return errors.internalError('Failed to push Hub Connector snapshot');
  }
};
