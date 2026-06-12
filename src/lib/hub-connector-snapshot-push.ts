import {
  hubConnectorQueries,
  readLpHubConnectorEnabled,
} from './db';
import { buildHubExportPayload } from './hub-export';

export type HubConnectorSnapshotPushResult =
  | { pushed: true; status: number }
  | { pushed: false; reason: string; status?: number };

export async function pushHubConnectorSnapshot(params: {
  db: D1Database;
  workspaceId: string;
  lpId: string;
  requestUrl: URL;
}): Promise<HubConnectorSnapshotPushResult> {
  const config = await hubConnectorQueries.getSnapshotPushConfig(
    params.db,
    params.workspaceId
  );
  if (!config) return { pushed: false, reason: 'not_configured' };
  if (!config.enabled) return { pushed: false, reason: 'disabled' };
  if (config.status !== 'active') return { pushed: false, reason: 'inactive' };
  if (!config.scriptEnabled) {
    return { pushed: false, reason: 'script_disabled' };
  }

  const exported = await buildHubExportPayload({
    db: params.db,
    workspaceId: params.workspaceId,
    lpId: params.lpId,
    requestUrl: params.requestUrl,
  });
  if (!exported.ok) return { pushed: false, reason: 'export_unavailable' };
  if (!readLpHubConnectorEnabled(String(exported.value.page.meta ?? ''))) {
    return { pushed: false, reason: 'lp_disabled' };
  }

  const endpoint = `${config.hubBaseUrl.replace(/\/+$/g, '')}/api/core/connections/${encodeURIComponent(
    config.connectionId
  )}/snapshots`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${config.snapshotPushToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        core_lp_id: params.lpId,
        export_payload: exported.value,
      }),
    });
  } catch {
    return { pushed: false, reason: 'request_failed' };
  }

  if (!response.ok) {
    return {
      pushed: false,
      reason: 'connector_rejected',
      status: response.status,
    };
  }
  return { pushed: true, status: response.status };
}
