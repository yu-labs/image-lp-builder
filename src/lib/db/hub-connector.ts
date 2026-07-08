import { randomUUID } from '../uuid';

export type HubConnectorStatus = 'pending' | 'active' | 'error' | 'disabled';

const HUB_CONNECTOR_TYPE = 'hub_connector';

const HUB_CONNECTOR_STATUSES: ReadonlyArray<HubConnectorStatus> = [
  'pending',
  'active',
  'error',
  'disabled',
];

/**
 * Raw `connections` row whose `type = 'hub_connector'`. Kept private
 * to db.ts so callers can never accidentally read `server_token_encrypted`;
 * the helpers below return `ResolvedHubConnector` instead.
 */
interface HubConnectorRow {
  id: string;
  workspace_id: string;
  type: string;
  connection_id: string | null;
  hub_base_url: string | null;
  script_url: string | null;
  server_token_encrypted: string | null;
  snapshot_push_token: string | null;
  status: string;
  enabled: number;
  connected_at: string | null;
  last_verified_at: string | null;
  meta: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Safe, parsed view of the workspace's Hub Connector row. Intentionally
 * omits `server_token_encrypted` so the field can never reach the
 * public HTML or an admin API by accident. `scriptEnabled` is hoisted
 * out of `meta.script_enabled` for ergonomics; the rest of `meta`
 * stays in `meta`.
 */
export interface ResolvedHubConnector {
  connectionId: string | null;
  hubBaseUrl: string | null;
  scriptUrl: string | null;
  enabled: boolean;
  status: HubConnectorStatus;
  scriptEnabled: boolean;
  serverTokenConfigured: boolean;
  snapshotPushTokenConfigured: boolean;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  meta: Record<string, unknown>;
}

export interface HubConnectorUpsertParams {
  connectionId?: string | null;
  hubBaseUrl?: string | null;
  scriptUrl?: string | null;
  /**
   * Write-only: stored on the connections row but never returned by
   * `get` / `upsert` (the resolved type intentionally omits it). The
   * hashing itself is the caller's responsibility — db.ts never
   * exposes the stored value to the public HTML or admin API payloads.
   */
  serverTokenEncrypted?: string | null;
  /**
   * Write-only outbound credential used by Core to push published
   * snapshots to Connector. This must never be returned by safe APIs.
   */
  snapshotPushToken?: string | null;
  status?: HubConnectorStatus;
  enabled?: boolean;
  scriptEnabled?: boolean;
  connectedAt?: string | null;
  lastVerifiedAt?: string | null;
  meta?: Record<string, unknown>;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseHubConnectorMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to empty — broken meta JSON must not break the LP
  }
  return {};
}

function resolveHubConnectorStatus(value: unknown): HubConnectorStatus {
  if (
    typeof value === 'string' &&
    (HUB_CONNECTOR_STATUSES as readonly string[]).includes(value)
  ) {
    return value as HubConnectorStatus;
  }
  return 'pending';
}

function toResolvedHubConnector(row: HubConnectorRow): ResolvedHubConnector {
  const meta = parseHubConnectorMeta(row.meta);
  const scriptEnabledRaw = meta.script_enabled;
  return {
    connectionId: row.connection_id,
    hubBaseUrl: row.hub_base_url,
    scriptUrl: row.script_url,
    enabled: row.enabled === 1,
    status: resolveHubConnectorStatus(row.status),
    scriptEnabled: scriptEnabledRaw === true,
    serverTokenConfigured:
      typeof row.server_token_encrypted === 'string' &&
      row.server_token_encrypted.startsWith('sha256:') &&
      row.server_token_encrypted.length > 'sha256:'.length,
    snapshotPushTokenConfigured:
      typeof row.snapshot_push_token === 'string' &&
      row.snapshot_push_token.length >= 16,
    connectedAt: row.connected_at,
    lastVerifiedAt: row.last_verified_at,
    meta,
  };
}

export const hubConnectorQueries = {
  async get(
    db: D1Database,
    workspaceId: string
  ): Promise<ResolvedHubConnector | null> {
    const row = await db
      .prepare(
        `SELECT * FROM connections
         WHERE workspace_id = ? AND type = ?
         LIMIT 1`
      )
      .bind(workspaceId, HUB_CONNECTOR_TYPE)
      .first<HubConnectorRow>();
    if (!row) return null;
    return toResolvedHubConnector(row);
  },

  /**
   * Insert-or-update the workspace's Hub Connector row. Only fields
   * present in `params` are touched; everything else carries over from
   * the existing row (or, on first insert, falls to its column
   * default). `scriptEnabled`, when provided, is folded into
   * `meta.script_enabled` so the boolean lives alongside the rest of
   * the meta blob.
   *
   * Throws if `script_url` / `hub_base_url` are present but not
   * https:// — the upsert is rejected outright so the table never
   * stores an unsafe URL.
   */
  async upsert(
    db: D1Database,
    workspaceId: string,
    params: HubConnectorUpsertParams
  ): Promise<ResolvedHubConnector> {
    if (params.scriptUrl !== undefined && params.scriptUrl !== null) {
      if (!isHttpsUrl(params.scriptUrl)) {
        throw new Error('script_url must be an https:// URL');
      }
    }
    if (params.hubBaseUrl !== undefined && params.hubBaseUrl !== null) {
      if (!isHttpsUrl(params.hubBaseUrl)) {
        throw new Error('hub_base_url must be an https:// URL');
      }
    }

    const existing = await db
      .prepare(
        `SELECT * FROM connections
         WHERE workspace_id = ? AND type = ?
         LIMIT 1`
      )
      .bind(workspaceId, HUB_CONNECTOR_TYPE)
      .first<HubConnectorRow>();

    const existingMeta = parseHubConnectorMeta(existing?.meta ?? null);
    let mergedMeta: Record<string, unknown> = {
      ...existingMeta,
      ...(params.meta ?? {}),
    };
    if (params.scriptEnabled !== undefined) {
      mergedMeta = { ...mergedMeta, script_enabled: params.scriptEnabled };
    }
    const metaJson = JSON.stringify(mergedMeta);

    if (existing) {
      const fields: string[] = [];
      const binds: (string | number | null)[] = [];
      if (params.connectionId !== undefined) {
        fields.push('connection_id = ?');
        binds.push(params.connectionId);
      }
      if (params.hubBaseUrl !== undefined) {
        fields.push('hub_base_url = ?');
        binds.push(params.hubBaseUrl);
      }
      if (params.scriptUrl !== undefined) {
        fields.push('script_url = ?');
        binds.push(params.scriptUrl);
      }
      if (params.serverTokenEncrypted !== undefined) {
        fields.push('server_token_encrypted = ?');
        binds.push(params.serverTokenEncrypted);
      }
      if (params.snapshotPushToken !== undefined) {
        fields.push('snapshot_push_token = ?');
        binds.push(params.snapshotPushToken);
      }
      if (params.status !== undefined) {
        fields.push('status = ?');
        binds.push(params.status);
      }
      if (params.enabled !== undefined) {
        fields.push('enabled = ?');
        binds.push(params.enabled ? 1 : 0);
      }
      if (params.connectedAt !== undefined) {
        fields.push('connected_at = ?');
        binds.push(params.connectedAt);
      }
      if (params.lastVerifiedAt !== undefined) {
        fields.push('last_verified_at = ?');
        binds.push(params.lastVerifiedAt);
      }
      fields.push('meta = ?');
      binds.push(metaJson);
      fields.push("updated_at = datetime('now')");
      binds.push(workspaceId, HUB_CONNECTOR_TYPE);
      await db
        .prepare(
          `UPDATE connections SET ${fields.join(', ')}
           WHERE workspace_id = ? AND type = ?`
        )
        .bind(...binds)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO connections
             (id, workspace_id, type, connection_id, hub_base_url, script_url,
              server_token_encrypted, snapshot_push_token, status, enabled, connected_at,
              last_verified_at, meta)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          randomUUID(),
          workspaceId,
          HUB_CONNECTOR_TYPE,
          params.connectionId ?? null,
          params.hubBaseUrl ?? null,
          params.scriptUrl ?? null,
          params.serverTokenEncrypted ?? null,
          params.snapshotPushToken ?? null,
          params.status ?? 'pending',
          params.enabled ? 1 : 0,
          params.connectedAt ?? null,
          params.lastVerifiedAt ?? null,
          metaJson
        )
        .run();
    }

    const after = await this.get(db, workspaceId);
    if (!after) throw new Error('Failed to upsert hub_connector');
    return after;
  },

  /**
   * Toggle the workspace-wide on/off for the Hub Connector row. No-op
   * (returns null) when the row doesn't exist yet.
   */
  async setEnabled(
    db: D1Database,
    workspaceId: string,
    enabled: boolean
  ): Promise<ResolvedHubConnector | null> {
    const result = await db
      .prepare(
        `UPDATE connections
         SET enabled = ?, updated_at = datetime('now')
         WHERE workspace_id = ? AND type = ?`
      )
      .bind(enabled ? 1 : 0, workspaceId, HUB_CONNECTOR_TYPE)
      .run();
    if (result.meta.changes === 0) return null;
    return this.get(db, workspaceId);
  },

  async getSnapshotPushConfig(
    db: D1Database,
    workspaceId: string
  ): Promise<{
    connectionId: string;
    hubBaseUrl: string;
    snapshotPushToken: string;
    enabled: boolean;
    status: HubConnectorStatus;
    scriptEnabled: boolean;
  } | null> {
    const row = await db
      .prepare(
        `SELECT * FROM connections
         WHERE workspace_id = ? AND type = ?
         LIMIT 1`
      )
      .bind(workspaceId, HUB_CONNECTOR_TYPE)
      .first<HubConnectorRow>();
    if (!row) return null;

    const meta = parseHubConnectorMeta(row.meta);
    const connectionId = row.connection_id?.trim();
    const hubBaseUrl = row.hub_base_url?.trim();
    const snapshotPushToken = row.snapshot_push_token?.trim();
    if (!connectionId || !hubBaseUrl || !snapshotPushToken) return null;

    return {
      connectionId,
      hubBaseUrl,
      snapshotPushToken,
      enabled: row.enabled === 1,
      status: resolveHubConnectorStatus(row.status),
      scriptEnabled: meta.script_enabled === true,
    };
  },
};

/**
 * Public-safe attrs the renderer needs to emit the Hub Connector
 * `<script>` tag. Only identifiers that are intentionally surfaced on
 * the public HTML — never the server token, never workspace internals.
 */
export interface HubConnectorScriptDescriptor {
  scriptUrl: string;
  connectionId: string;
  lpId: string;
  versionId: string;
  publicationId: string;
  publicUrl: string;
}

/**
 * Decide whether the public renderer should emit the connector
 * `<script>` tag for this LP/version/publication, and if so, return
 * the descriptor needed to render it. Returns null when *any* of the
 * safety conditions don't hold, so the call site can just check for
 * null without re-deriving the rules:
 *
 *   - workspace's hub_connector row exists, is enabled, status='active'
 *   - script_url is a valid https URL
 *   - meta.script_enabled is true
 *   - lp / version / publication ids are all present
 *   - publicUrl is known
 */
export function resolveHubConnectorScript(params: {
  resolved: ResolvedHubConnector | null;
  lpId: string | null | undefined;
  versionId: string | null | undefined;
  publicationId: string | null | undefined;
  publicUrl: string | null | undefined;
}): HubConnectorScriptDescriptor | null {
  const { resolved, lpId, versionId, publicationId, publicUrl } = params;
  if (!resolved) return null;
  if (!resolved.enabled) return null;
  if (resolved.status !== 'active') return null;
  if (!resolved.scriptEnabled) return null;
  if (!resolved.scriptUrl || !isHttpsUrl(resolved.scriptUrl)) return null;
  if (!resolved.connectionId) return null;
  if (!lpId || !versionId || !publicationId) return null;
  if (!publicUrl) return null;
  return {
    scriptUrl: resolved.scriptUrl,
    connectionId: resolved.connectionId,
    lpId,
    versionId,
    publicationId,
    publicUrl,
  };
}
