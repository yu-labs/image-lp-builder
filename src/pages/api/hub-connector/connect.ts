/**
 * POST /api/hub-connector/connect
 *
 * Exchanges a connector-issued code/URL for the existing low-level Hub
 * Connector settings, then stores them in the current connections row.
 * Failed exchanges never modify the saved settings.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { errors, success } from '../../../lib/api';
import { hubConnectorQueries } from '../../../lib/db';
import { parseHubConnectorCode } from '../../../lib/hub-connector-code';
import {
  exchangeHubConnectorCode,
  redactExchangeUrl,
  toSafeHubConnectorPayload,
} from '../../../lib/hub-connector-code';
import { hashHubConnectorToken } from '../../../lib/hub-connector-auth';
import { CURRENT_VERSION } from '../../../lib/version';

export const prerender = false;

function messageForCodeError(error: string): string {
  if (error === 'empty') return '接続コードを入力してください';
  if (error === 'invalid_format') {
    return 'connectorが発行した接続コードまたは接続URLを入力してください';
  }
  if (
    error === 'missing_default_exchange_url' ||
    error === 'invalid_default_exchange_url'
  ) {
    return '短い接続コードを使うには、既定のconnector交換URLを設定してください';
  }
  if (error === 'invalid_response') return '接続情報が不正です';
  return '接続先を確認できませんでした';
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  const typedEnv = env as Env;
  const workspaceId = locals.workspace_id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.validationError('Body must be valid JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errors.validationError('Body must be a JSON object');
  }

  const connectCode = (body as Record<string, unknown>).connectCode;
  if (typeof connectCode !== 'string') {
    return errors.validationError('接続コードを入力してください', {
      field: 'connectCode',
    });
  }

  const parsed = parseHubConnectorCode(
    connectCode,
    typedEnv.HUB_CONNECTOR_DEFAULT_EXCHANGE_URL
  );
  if (!parsed.ok) {
    return errors.validationError(messageForCodeError(parsed.error), {
      field: 'connectCode',
    });
  }

  const exchanged = await exchangeHubConnectorCode(parsed.value, CURRENT_VERSION);
  if (!exchanged.ok) {
    console.warn('Hub Connector code exchange failed', {
      error: exchanged.error,
      exchangeUrl: redactExchangeUrl(parsed.value.exchangeUrl),
    });
    return errors.validationError(messageForCodeError(exchanged.error), {
      field: 'connectCode',
    });
  }

  const now = new Date().toISOString();
  try {
    const after = await hubConnectorQueries.upsert(env.DB, workspaceId, {
      connectionId: exchanged.value.connectionId,
      hubBaseUrl: exchanged.value.hubBaseUrl,
      scriptUrl: exchanged.value.scriptUrl,
      serverTokenEncrypted: await hashHubConnectorToken(exchanged.value.serverToken),
      snapshotPushToken: exchanged.value.snapshotPushToken,
      enabled: exchanged.value.enabled,
      scriptEnabled: exchanged.value.scriptEnabled,
      status: 'active',
      connectedAt: now,
      lastVerifiedAt: now,
    });
    return success(toSafeHubConnectorPayload(after));
  } catch (err) {
    console.error('POST /api/hub-connector/connect failed:', err);
    return errors.internalError('保存できませんでした');
  }
};
