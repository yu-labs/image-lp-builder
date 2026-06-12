import type { ResolvedHubConnector } from './db';
import {
  HUB_CONNECTOR_TOKEN_MAX_LENGTH,
  HUB_CONNECTOR_TOKEN_MIN_LENGTH,
} from './hub-connector-auth';

export const SAFE_HUB_CONNECTOR_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

const CONNECT_CODE_PATTERN = /^[a-zA-Z0-9._~-]{3,512}$/;
const STRUCTURED_PREFIX = 'ilpb-connect:v1:';

export interface SafeHubConnectorPayload {
  enabled: boolean;
  scriptEnabled: boolean;
  scriptUrl: string | null;
  hubBaseUrl: string | null;
  connectionId: string | null;
  status: string | null;
  serverTokenConfigured: boolean;
  snapshotPushTokenConfigured: boolean;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
}

export interface ParsedHubConnectorCode {
  exchangeUrl: string;
  connectCode: string;
}

export interface HubConnectorExchangeResult {
  connectionId: string;
  hubBaseUrl: string;
  scriptUrl: string;
  serverToken: string;
  snapshotPushToken: string;
  enabled: boolean;
  scriptEnabled: boolean;
}

export type HubConnectorCodeError =
  | 'empty'
  | 'invalid_format'
  | 'invalid_default_exchange_url'
  | 'missing_default_exchange_url'
  | 'exchange_unreachable'
  | 'exchange_rejected'
  | 'invalid_response';

export type HubConnectorCodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: HubConnectorCodeError };

interface StructuredCodePayload {
  exchange_url?: unknown;
  connect_code?: unknown;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isSafeConnectCode(value: string): boolean {
  return CONNECT_CODE_PATTERN.test(value);
}

function decodeBase64UrlJson(value: string): StructuredCodePayload | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const json = atob(padded);
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as StructuredCodePayload;
    }
  } catch {
    // Invalid codes are handled by the caller as invalid_format.
  }
  return null;
}

function extractCodeFromUrl(url: URL): string | null {
  const queryCode = url.searchParams.get('code')?.trim();
  if (queryCode && isSafeConnectCode(queryCode)) return queryCode;

  const lastPathPart = url.pathname
    .split('/')
    .filter(Boolean)
    .at(-1)
    ?.trim();
  if (lastPathPart && isSafeConnectCode(lastPathPart)) return lastPathPart;
  return null;
}

export function toSafeHubConnectorPayload(
  connector: ResolvedHubConnector | null
): SafeHubConnectorPayload {
  return connector
    ? {
        enabled: connector.enabled,
        scriptEnabled: connector.scriptEnabled,
        scriptUrl: connector.scriptUrl,
        hubBaseUrl: connector.hubBaseUrl,
        connectionId: connector.connectionId,
        status: connector.status,
        serverTokenConfigured: connector.serverTokenConfigured,
        snapshotPushTokenConfigured: connector.snapshotPushTokenConfigured,
        connectedAt: connector.connectedAt,
        lastVerifiedAt: connector.lastVerifiedAt,
      }
    : {
        enabled: false,
        scriptEnabled: false,
        scriptUrl: null,
        hubBaseUrl: null,
        connectionId: null,
        status: null,
        serverTokenConfigured: false,
        snapshotPushTokenConfigured: false,
        connectedAt: null,
        lastVerifiedAt: null,
      };
}

export function parseHubConnectorCode(
  input: string,
  defaultExchangeUrl?: string
): HubConnectorCodeResult<ParsedHubConnectorCode> {
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'empty' };

  if (raw.startsWith(STRUCTURED_PREFIX)) {
    const payload = decodeBase64UrlJson(raw.slice(STRUCTURED_PREFIX.length));
    const exchangeUrl =
      typeof payload?.exchange_url === 'string' ? payload.exchange_url.trim() : '';
    const connectCode =
      typeof payload?.connect_code === 'string' ? payload.connect_code.trim() : '';
    if (
      !exchangeUrl ||
      !connectCode ||
      !isHttpsUrl(exchangeUrl) ||
      !isSafeConnectCode(connectCode)
    ) {
      return { ok: false, error: 'invalid_format' };
    }
    return { ok: true, value: { exchangeUrl, connectCode } };
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return { ok: false, error: 'invalid_format' };
    const connectCode = extractCodeFromUrl(url);
    if (!connectCode) return { ok: false, error: 'invalid_format' };
    url.hash = '';
    return { ok: true, value: { exchangeUrl: url.toString(), connectCode } };
  } catch {
    // Not a URL; treat it as a short connector code below.
  }

  if (!isSafeConnectCode(raw)) return { ok: false, error: 'invalid_format' };
  if (!defaultExchangeUrl?.trim()) {
    return { ok: false, error: 'missing_default_exchange_url' };
  }
  const exchangeUrl = defaultExchangeUrl.trim();
  if (!isHttpsUrl(exchangeUrl)) {
    return { ok: false, error: 'invalid_default_exchange_url' };
  }
  return { ok: true, value: { exchangeUrl, connectCode: raw } };
}

function validateExchangeResponse(
  body: unknown
): HubConnectorCodeResult<HubConnectorExchangeResult> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_response' };
  }
  const obj = body as Record<string, unknown>;
  const connectionId =
    typeof obj.connection_id === 'string' ? obj.connection_id.trim() : '';
  const hubBaseUrl =
    typeof obj.hub_base_url === 'string' ? obj.hub_base_url.trim() : '';
  const scriptUrl =
    typeof obj.script_url === 'string' ? obj.script_url.trim() : '';
  const serverToken =
    typeof obj.server_token === 'string' ? obj.server_token.trim() : '';
  const snapshotPushToken =
    typeof obj.snapshot_push_token === 'string'
      ? obj.snapshot_push_token.trim()
      : '';
  const enabled = obj.enabled;
  const scriptEnabled = obj.script_enabled;

  if (
    !SAFE_HUB_CONNECTOR_ID_PATTERN.test(connectionId) ||
    !isHttpsUrl(hubBaseUrl) ||
    !isHttpsUrl(scriptUrl) ||
    serverToken.length < HUB_CONNECTOR_TOKEN_MIN_LENGTH ||
    serverToken.length > HUB_CONNECTOR_TOKEN_MAX_LENGTH ||
    snapshotPushToken.length < HUB_CONNECTOR_TOKEN_MIN_LENGTH ||
    snapshotPushToken.length > HUB_CONNECTOR_TOKEN_MAX_LENGTH ||
    typeof enabled !== 'boolean' ||
    typeof scriptEnabled !== 'boolean'
  ) {
    return { ok: false, error: 'invalid_response' };
  }

  return {
    ok: true,
    value: {
      connectionId,
      hubBaseUrl,
      scriptUrl,
      serverToken,
      snapshotPushToken,
      enabled,
      scriptEnabled,
    },
  };
}

export async function exchangeHubConnectorCode(
  parsed: ParsedHubConnectorCode,
  version: string
): Promise<HubConnectorCodeResult<HubConnectorExchangeResult>> {
  let response: Response;
  try {
    response = await fetch(parsed.exchangeUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connect_code: parsed.connectCode,
        core: {
          app: 'image-lp-builder',
          version,
        },
      }),
    });
  } catch {
    return { ok: false, error: 'exchange_unreachable' };
  }

  if (!response.ok) return { ok: false, error: 'exchange_rejected' };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: 'invalid_response' };
  }
  return validateExchangeResponse(body);
}

export function redactExchangeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return 'invalid-url';
  }
}
