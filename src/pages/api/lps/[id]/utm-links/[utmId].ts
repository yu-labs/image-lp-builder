/**
 * PATCH  /api/lps/:id/utm-links/:utmId
 * DELETE /api/lps/:id/utm-links/:utmId
 *
 * Removes a UTM link. The /go/:shortPath URL stops working
 * immediately. (No "soft delete" — campaign links are usually
 * disposable.)
 *
 * Authentication is enforced by middleware.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { utmLinkQueries } from '../../../../../lib/db';
import { success, errors } from '../../../../../lib/api';

export const prerender = false;

const LABEL_MAX = 80;
const FIELD_MAX = 200;

function pickUtmField(
  raw: unknown,
  field: string
): { value: string | null; error?: string } {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  if (typeof raw !== 'string') {
    return { value: null, error: `\`${field}\` must be a string or null` };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { value: null };
  if (trimmed.length > FIELD_MAX) {
    return { value: null, error: `\`${field}\` is too long` };
  }
  return { value: trimmed };
}

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  const id = params.id;
  const utmId = params.utmId;
  if (typeof id !== 'string' || id.length === 0) {
    return errors.validationError('LP id is required', { field: 'id' });
  }
  if (typeof utmId !== 'string' || utmId.length === 0) {
    return errors.validationError('UTM link id is required', { field: 'utmId' });
  }

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
  const labelRaw = input.label;
  if (typeof labelRaw !== 'string' || labelRaw.trim().length === 0) {
    return errors.validationError('`label` is required', { field: 'label' });
  }
  if (labelRaw.length > LABEL_MAX) {
    return errors.validationError(
      `\`label\` must be ${LABEL_MAX} characters or fewer`,
      { field: 'label' }
    );
  }

  const fields = {
    utmSource: pickUtmField(input.utmSource, 'utmSource'),
    utmMedium: pickUtmField(input.utmMedium, 'utmMedium'),
    utmCampaign: pickUtmField(input.utmCampaign, 'utmCampaign'),
    utmContent: pickUtmField(input.utmContent, 'utmContent'),
    utmTerm: pickUtmField(input.utmTerm, 'utmTerm'),
  };
  for (const [key, result] of Object.entries(fields)) {
    if (result.error) {
      return errors.validationError(result.error, { field: key });
    }
  }

  try {
    const updated = await utmLinkQueries.update(
      env.DB,
      workspaceId,
      id,
      utmId,
      {
        label: labelRaw.trim(),
        utmSource: fields.utmSource.value,
        utmMedium: fields.utmMedium.value,
        utmCampaign: fields.utmCampaign.value,
        utmContent: fields.utmContent.value,
        utmTerm: fields.utmTerm.value,
      }
    );
    if (!updated) return errors.notFound(`UTM link \`${utmId}\` not found`);
    return success(updated);
  } catch (err) {
    console.error(`PATCH /api/lps/.../utm-links/${utmId} failed:`, err);
    return errors.internalError('Failed to update UTM link');
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  const utmId = params.utmId;
  if (typeof utmId !== 'string' || utmId.length === 0) {
    return errors.validationError('UTM link id is required', { field: 'utmId' });
  }
  try {
    const removed = await utmLinkQueries.remove(env.DB, workspaceId, utmId);
    if (!removed) return errors.notFound(`UTM link \`${utmId}\` not found`);
    return success({ id: utmId, removed: true });
  } catch (err) {
    console.error(`DELETE /api/lps/.../utm-links/${utmId} failed:`, err);
    return errors.internalError('Failed to delete UTM link');
  }
};
