/**
 * /api/hub-connector
 *
 * GET -> read workspace Hub Connector settings (no secret fields)
 * PUT -> partial update: enabled, scriptEnabled, scriptUrl, hubBaseUrl,
 *        connectionId, serverToken
 *
 * server_token_encrypted is never returned here. PUT accepts a raw
 * serverToken, hashes it, and stores only the hash.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { hubConnectorQueries } from '../../lib/db';
import type { HubConnectorUpsertParams } from '../../lib/db';
import { errors, success } from '../../lib/api';
import {
  HUB_CONNECTOR_TOKEN_MAX_LENGTH,
  HUB_CONNECTOR_TOKEN_MIN_LENGTH,
  hashHubConnectorToken,
} from '../../lib/hub-connector-auth';
import {
  SAFE_HUB_CONNECTOR_ID_PATTERN,
  toSafeHubConnectorPayload,
} from '../../lib/hub-connector-code';

export const prerender = false;

function isHttpsUrl(v: string): boolean {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

export const GET: APIRoute = async ({ locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;
  try {
    const connector = await hubConnectorQueries.get(env.DB, workspaceId);
    return success(toSafeHubConnectorPayload(connector));
  } catch (err) {
    console.error('GET /api/hub-connector failed:', err);
    return errors.internalError('Failed to load Hub Connector settings');
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const workspaceId = locals.workspace_id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('Body must be valid JSON');
  }
  if (typeof body !== 'object' || body === null) {
    return errors.validationError('Body must be a JSON object');
  }
  const obj = body as Record<string, unknown>;

  const params: HubConnectorUpsertParams = {};

  if ('enabled' in obj) {
    if (typeof obj.enabled !== 'boolean') {
      return errors.validationError('`enabled` must be a boolean', {
        field: 'enabled',
      });
    }
    params.enabled = obj.enabled;
  }

  if ('scriptEnabled' in obj) {
    if (typeof obj.scriptEnabled !== 'boolean') {
      return errors.validationError('`scriptEnabled` must be a boolean', {
        field: 'scriptEnabled',
      });
    }
    params.scriptEnabled = obj.scriptEnabled;
  }

  if ('scriptUrl' in obj) {
    const v = obj.scriptUrl;
    if (v === null || v === '') {
      params.scriptUrl = null;
    } else if (typeof v !== 'string') {
      return errors.validationError('`scriptUrl` must be a string or null', {
        field: 'scriptUrl',
      });
    } else if (!isHttpsUrl(v)) {
      return errors.validationError('`scriptUrl` must be an https:// URL', {
        field: 'scriptUrl',
      });
    } else {
      params.scriptUrl = v;
    }
  }

  if ('hubBaseUrl' in obj) {
    const v = obj.hubBaseUrl;
    if (v === null || v === '') {
      params.hubBaseUrl = null;
    } else if (typeof v !== 'string') {
      return errors.validationError('`hubBaseUrl` must be a string or null', {
        field: 'hubBaseUrl',
      });
    } else if (!isHttpsUrl(v)) {
      return errors.validationError('`hubBaseUrl` must be an https:// URL', {
        field: 'hubBaseUrl',
      });
    } else {
      params.hubBaseUrl = v;
    }
  }

  if ('connectionId' in obj) {
    const v = obj.connectionId;
    if (v === null || v === '') {
      params.connectionId = null;
    } else if (typeof v !== 'string') {
      return errors.validationError('`connectionId` must be a string or null', {
        field: 'connectionId',
      });
    } else if (!SAFE_HUB_CONNECTOR_ID_PATTERN.test(v)) {
      return errors.validationError(
        '`connectionId` may only contain letters, numbers, hyphens, and underscores',
        { field: 'connectionId' }
      );
    } else {
      params.connectionId = v;
    }
  }

  if ('serverToken' in obj) {
    const v = obj.serverToken;
    if (v === null || v === '') {
      params.serverTokenEncrypted = null;
      params.status = 'pending';
      params.connectedAt = null;
      params.lastVerifiedAt = null;
    } else if (typeof v !== 'string') {
      return errors.validationError('`serverToken` must be a string or null', {
        field: 'serverToken',
      });
    } else {
      const token = v.trim();
      if (
        token.length < HUB_CONNECTOR_TOKEN_MIN_LENGTH ||
        token.length > HUB_CONNECTOR_TOKEN_MAX_LENGTH
      ) {
        return errors.validationError(
          `serverToken must be ${HUB_CONNECTOR_TOKEN_MIN_LENGTH}-${HUB_CONNECTOR_TOKEN_MAX_LENGTH} characters`,
          { field: 'serverToken' }
        );
      }
      const now = new Date().toISOString();
      params.serverTokenEncrypted = await hashHubConnectorToken(token);
      params.status = 'active';
      params.connectedAt = now;
      params.lastVerifiedAt = now;
    }
  }

  if (Object.keys(params).length === 0) {
    return errors.validationError('No supported fields in request body');
  }

  try {
    const after = await hubConnectorQueries.upsert(env.DB, workspaceId, params);
    return success(toSafeHubConnectorPayload(after));
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('https://')) {
      return errors.validationError(msg);
    }
    console.error('PUT /api/hub-connector failed:', err);
    return errors.internalError('Failed to update Hub Connector settings');
  }
};
