/**
 * POST /api/admin/update/revert
 *
 * Roll the customer's main branch back to its parent commit and
 * mark the lock 'failed' with a "rolled back" message. Called by the
 * /admin/update polling loop when:
 *
 *   - The build stage exceeds the polling deadline (~5 min) without
 *     /api/version flipping over: we infer that Cloudflare Workers
 *     Builds either failed or is stuck, push the revert so the next
 *     CF rebuild swaps the broken isolate out, and surface a clear
 *     failure to the operator instead of letting the spinner run for
 *     the full TTL.
 *
 *   - The status endpoint reports stage='failed' with errorMessage
 *     containing the migration-failure marker (the new isolate's
 *     middleware already rolled the DB back; we still need to push
 *     the GitHub revert so the next deploy doesn't re-run the same
 *     broken commit).
 *
 * Idempotent: if the customer HEAD has already been rewound (or has
 * no parent), the endpoint reports it and still ensures the lock is
 * marked failed.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { errors, success } from '../../../../lib/api';
import { revertCustomerHeadToParent } from '../../../../lib/github-revert';
import { markFailed } from '../../../../lib/update-lock';

export const prerender = false;

interface RevertBody {
  reason?: string;
}

export const POST: APIRoute = async ({ locals, request }) => {
  if (!env?.DB) return errors.internalError('Database not configured');
  if (!env?.RATE_LIMIT) return errors.internalError('KV not configured');

  let body: RevertBody = {};
  try {
    const raw = await request.text();
    if (raw.trim().length > 0) {
      body = JSON.parse(raw) as RevertBody;
    }
  } catch {
    // Empty / malformed bodies are fine — the reason field is optional.
  }
  const reason = sanitizeReason(body.reason);

  const result = await revertCustomerHeadToParent({
    db: env.DB,
    workspaceId: locals.workspace_id,
    relayUrlOverride: env?.OAUTH_RELAY_URL,
  });

  // Always mark the lock failed, even when the revert is a noop or
  // errored: the polling loop will route the operator to the failure
  // UI and we don't want a half-state.
  await markFailed(
    env.RATE_LIMIT,
    locals.workspace_id,
    buildFailureMessage(result.status, reason, result.message)
  );

  return success({
    revert: {
      status: result.status,
      message: result.message,
      reverted_from: result.revertedFromSha ?? null,
      reverted_to: result.revertedToSha ?? null,
    },
  });
};

/**
 * Reason strings come from a few internal call sites (build_timeout,
 * migration_failure). Anything else is treated as a free-form note;
 * length-cap so the lock payload doesn't grow unbounded.
 */
function sanitizeReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 80);
}

function buildFailureMessage(
  status: 'reverted' | 'noop' | 'no_install' | 'error',
  reason: string | null,
  detail: string
): string {
  const reasonHint =
    reason === 'build_timeout'
      ? 'Cloudflare のビルドが時間内に完了しませんでした。'
      : reason === 'migration_failure'
        ? 'データベースの更新に失敗したため、自動的に元に戻しました。'
        : 'アップデートの途中で問題が発生しました。';

  if (status === 'reverted') {
    return `${reasonHint} GitHub の変更を元に戻しました。もう一度お試しください。`;
  }
  if (status === 'noop') {
    return `${reasonHint} 巻き戻し対象の差分はありませんでした。`;
  }
  if (status === 'no_install') {
    return `${reasonHint} GitHub App の連携情報が見つからず、自動的な巻き戻しができませんでした。手動でロールバックしてください。`;
  }
  return `${reasonHint} 自動的な巻き戻しに失敗しました(${detail.slice(0, 80)})。GitHub と Cloudflare の状態を確認してください。`;
}
