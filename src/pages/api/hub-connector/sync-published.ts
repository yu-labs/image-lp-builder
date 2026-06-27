/**
 * POST /api/hub-connector/sync-published
 *
 * Sends every currently-live published LP snapshot to the configured
 * Hub Connector. This is a backfill/sync operation only: it never
 * republishes an LP and never changes Builder page/version/publication
 * rows.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { errors, success } from '../../../lib/api';
import { hubConnectorQueries, pageQueries } from '../../../lib/db';
import {
  pushHubConnectorSnapshot,
  type HubConnectorSnapshotPushResult,
} from '../../../lib/hub-connector-snapshot-push';

export const prerender = false;

type SyncStatus = 'synced' | 'failed';

interface SyncResultItem {
  lpId: string;
  title: string | null;
  slug: string;
  status: SyncStatus;
  reason?: string;
  httpStatus?: number;
}

interface SyncPublishedPayload {
  total: number;
  synced: number;
  failed: number;
  results: SyncResultItem[];
}

function connectorConflict(reason: string, message: string): Response {
  return errors.conflict(message, { reason });
}

function classifyPushResult(
  result: HubConnectorSnapshotPushResult
): Pick<SyncResultItem, 'status' | 'reason' | 'httpStatus'> {
  if (result.pushed) {
    return { status: 'synced', httpStatus: result.status };
  }
  return {
    status: 'failed',
    reason: result.reason,
    ...(result.status ? { httpStatus: result.status } : {}),
  };
}

export const POST: APIRoute = async ({ locals, url }) => {
  if (!env?.DB) return errors.internalError('Database not configured');

  const workspaceId = locals.workspace_id;

  try {
    const config = await hubConnectorQueries.getSnapshotPushConfig(
      env.DB,
      workspaceId
    );
    if (!config) {
      return connectorConflict(
        'not_configured',
        '連携コネクターに接続してください'
      );
    }
    if (!config.enabled) {
      return connectorConflict('disabled', '連携コネクターをONにしてください');
    }
    if (config.status !== 'active') {
      return connectorConflict('inactive', '連携コネクターの接続を確認してください');
    }
    if (!config.scriptEnabled) {
      return connectorConflict(
        'script_disabled',
        'スクリプト出力をONにしてください'
      );
    }

    const pages = await pageQueries.listLivePublishedSummaries(
      env.DB,
      workspaceId
    );

    const results: SyncResultItem[] = [];
    for (const page of pages) {
      const pushed = await pushHubConnectorSnapshot({
        db: env.DB,
        workspaceId,
        lpId: page.id,
        requestUrl: url,
      });
      results.push({
        lpId: page.id,
        title: page.title,
        slug: page.slug,
        ...classifyPushResult(pushed),
      });
    }

    const payload: SyncPublishedPayload = {
      total: pages.length,
      synced: results.filter((item) => item.status === 'synced').length,
      failed: results.filter((item) => item.status === 'failed').length,
      results,
    };

    return success(payload);
  } catch (err) {
    console.error('POST /api/hub-connector/sync-published failed:', err);
    return errors.internalError('公開中LPを同期できませんでした');
  }
};
