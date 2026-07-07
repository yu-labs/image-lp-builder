import { hubConnectorQueries } from './db';
import { buildHubExportPayload } from './hub-export';
import { validateHubExportPayload } from './hub-export-contract';

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

  // Catch payload-shape drift on the sender side before it reaches the
  // receiving endpoint (same contract module runs on both sides).
  const contract = validateHubExportPayload(exported.value);
  if (!contract.ok) {
    console.error(
      'Hub connector snapshot push blocked by contract validation:',
      contract.errors.join('; ')
    );
    return { pushed: false, reason: 'contract_invalid' };
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
