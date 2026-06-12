/**
 * GET /api/hub/exports/:id
 *
 * Export the currently-published version of an LP for the Hub
 * Connector. Returns 404 when the LP isn't currently published —
 * draft / archived / trash rows are intentionally invisible to the
 * connector.
 *
 * Response shape (under `data`):
 *   - page         : public-safe subset of the pages row
 *   - version      : the `published_snapshot` page_versions row
 *   - publication  : the active publications row
 *   - sections     : sections array from the version's content
 *   - ctas         : flat list of CTAs across all sections
 *                    (each entry carries `section_id`)
 *   - images       : distinct image objects referenced anywhere in
 *                    the content, each carrying url / width / height /
 *                    alt / public_url (section images, in-section CTA
 *                    images, floating CTA image, meta.ogImage)
 *   - public_url   : canonical fully-qualified URL for the LP
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
import { success, errors } from '../../../../lib/api';
import { buildHubExportPayload } from '../../../../lib/hub-export';
import { requireHubConnectorAuth } from '../../../../lib/hub-connector-auth';

export const prerender = false;

export const GET: APIRoute = async ({ params, request, locals, url }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;
  const id = params.id;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }

  try {
    const authError = await requireHubConnectorAuth(
      env.DB,
      workspaceId,
      request
    );
    if (authError) return authError;

    const exported = await buildHubExportPayload({
      db: env.DB,
      workspaceId,
      lpId: id,
      requestUrl: url,
    });
    if (!exported.ok) return errors.notFound(exported.message);

    return success(exported.value);
  } catch (err) {
    console.error(`GET /api/hub/exports/${id} failed:`, err);
    return errors.internalError('Failed to export LP');
  }
};
