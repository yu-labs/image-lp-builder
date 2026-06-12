import { errors } from './api';

const HUB_CONNECTOR_TYPE = 'hub_connector';
const TOKEN_HASH_PREFIX = 'sha256:';

export const HUB_CONNECTOR_TOKEN_MIN_LENGTH = 16;
export const HUB_CONNECTOR_TOKEN_MAX_LENGTH = 256;

interface HubConnectorAuthRow {
  server_token_encrypted: string | null;
  status: string;
  enabled: number;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export async function hashHubConnectorToken(token: string): Promise<string> {
  return `${TOKEN_HASH_PREFIX}${await sha256Hex(token)}`;
}

export function isHubConnectorTokenConfigured(
  stored: string | null | undefined
): stored is string {
  return (
    typeof stored === 'string' &&
    stored.startsWith(TOKEN_HASH_PREFIX) &&
    stored.length > TOKEN_HASH_PREFIX.length
  );
}

export function readHubConnectorToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    const token = match?.[1]?.trim();
    if (token) return token;
  }

  const fallback = request.headers.get('x-hub-connector-token')?.trim();
  return fallback || null;
}

async function verifyHubConnectorToken(
  stored: string,
  supplied: string
): Promise<boolean> {
  const hashed = await hashHubConnectorToken(supplied);
  return constantTimeEqual(stored, hashed);
}

export async function requireHubConnectorAuth(
  db: D1Database,
  workspaceId: string,
  request: Request
): Promise<Response | null> {
  const token = readHubConnectorToken(request);
  if (!token) {
    return errors.unauthorized('Hub Connector token is required');
  }

  const row = await db
    .prepare(
      `SELECT server_token_encrypted, status, enabled
       FROM connections
       WHERE workspace_id = ? AND type = ?
       LIMIT 1`
    )
    .bind(workspaceId, HUB_CONNECTOR_TYPE)
    .first<HubConnectorAuthRow>();

  if (!row) {
    return errors.forbidden('Hub Connector is not configured');
  }
  if (!isHubConnectorTokenConfigured(row.server_token_encrypted)) {
    return errors.forbidden('Hub Connector token is not configured');
  }
  if (row.enabled !== 1) {
    return errors.forbidden('Hub Connector is not enabled for this workspace');
  }
  if (row.status !== 'active') {
    return errors.forbidden('Hub Connector is not active');
  }
  if (!(await verifyHubConnectorToken(row.server_token_encrypted, token))) {
    return errors.unauthorized('Invalid Hub Connector token');
  }

  return null;
}
