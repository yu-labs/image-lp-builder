/**
 * Best-effort rollback of the customer's repository HEAD ref.
 *
 * The self-update flow lands a new commit on the customer's main
 * branch via PATCH refs/heads/main; that PATCH is the bank-transaction
 * commit point. When a downstream step fails (Cloudflare Workers Builds
 * doesn't deploy in time, or migrations on the new isolate throw and
 * roll themselves back), we want the customer's repo to be byte-
 * identical to its pre-update state — otherwise the GitHub HEAD
 * disagrees with the live Worker version, and the next "Update now"
 * click would be a noop.
 *
 * Strategy:
 *   1. Read HEAD via GET /repos/:owner/:repo/git/ref/heads/main.
 *   2. Read its parent commit SHA.
 *   3. PATCH refs/heads/main back to the parent with `force: true`.
 *      (force is required because the move is non-fast-forward.)
 *
 * Cloudflare Workers Builds detects the new commit (the revert) and
 * rebuilds with the previous code, swapping the broken isolate out.
 * During the rebuild gap (1-3 min) the customer's site is whatever
 * the broken isolate served; once the rebuild lands the isolate flips
 * back to the prior version.
 *
 * This module is the single GitHub-side rollback path used by both
 * the build-timeout endpoint and the migration-failure detector in
 * the middleware.
 */

import { installationQueries } from './github-install';
import { getRelayUrl } from './oauth-client';
import { CURRENT_VERSION, REPO_SLUG } from './version';

const GH_API = 'https://api.github.com';
const CUSTOMER_BRANCH = 'main';

export interface RevertContext {
  db: D1Database;
  workspaceId: string;
  relayUrlOverride: string | undefined;
}

export interface RevertResult {
  status: 'reverted' | 'noop' | 'no_install' | 'error';
  message: string;
  revertedFromSha?: string;
  revertedToSha?: string;
}

/**
 * Roll the customer's main branch back to its previous commit.
 * Returns { status: 'noop' } when the customer HEAD has no parent
 * (initial commit only — nothing to revert to). Returns
 * { status: 'no_install' } when the workspace has no GitHub App
 * installation persisted. Throws on no other path: API failures are
 * caught and surfaced via { status: 'error' }.
 */
export async function revertCustomerHeadToParent(
  ctx: RevertContext
): Promise<RevertResult> {
  const installation = await installationQueries.get(ctx.db, ctx.workspaceId);
  if (!installation) {
    return {
      status: 'no_install',
      message: 'GitHub App is not installed for this workspace',
    };
  }

  let accessToken: string;
  try {
    accessToken = await mintAccessToken(
      ctx.relayUrlOverride,
      installation.installation_id
    );
  } catch (err) {
    return {
      status: 'error',
      message:
        err instanceof Error
          ? `access_token_failed: ${err.message}`
          : 'access_token_failed',
    };
  }

  let customerRepo: string;
  try {
    customerRepo = await discoverInstalledRepo(accessToken);
  } catch (err) {
    return {
      status: 'error',
      message:
        err instanceof Error
          ? `discover_repo_failed: ${err.message}`
          : 'discover_repo_failed',
    };
  }

  try {
    const ref = await ghJson<{ object: { sha: string } }>(
      `/repos/${customerRepo}/git/ref/heads/${CUSTOMER_BRANCH}`,
      accessToken
    );
    const headSha = ref.object.sha;
    const headCommit = await ghJson<{
      sha: string;
      parents: Array<{ sha: string }>;
    }>(`/repos/${customerRepo}/git/commits/${headSha}`, accessToken);

    const parent = headCommit.parents?.[0];
    if (!parent?.sha) {
      return {
        status: 'noop',
        message: 'HEAD has no parent commit; nothing to revert to',
        revertedFromSha: headSha,
      };
    }

    // Force-update main to the parent commit. force=true is required:
    // the new ref is an ancestor of the current ref, so the move is
    // non-fast-forward.
    await ghJson(
      `/repos/${customerRepo}/git/refs/heads/${CUSTOMER_BRANCH}`,
      accessToken,
      {
        method: 'PATCH',
        body: JSON.stringify({ sha: parent.sha, force: true }),
      }
    );

    return {
      status: 'reverted',
      message: `Customer HEAD rewound from ${headSha.slice(0, 7)} to ${parent.sha.slice(0, 7)}.`,
      revertedFromSha: headSha,
      revertedToSha: parent.sha,
    };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function mintAccessToken(
  relayUrlOverride: string | undefined,
  installationId: number
): Promise<string> {
  const relayUrl = getRelayUrl(relayUrlOverride);
  const res = await fetch(`${relayUrl}/oauth/github/access-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installation_id: installationId }),
  });
  if (!res.ok) {
    const detail = (await safeText(res)).slice(0, 200);
    throw new Error(`relay ${res.status}: ${detail}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (typeof json.access_token !== 'string') {
    throw new Error('relay returned unexpected shape');
  }
  return json.access_token;
}

async function discoverInstalledRepo(accessToken: string): Promise<string> {
  const json = await ghJson<{
    repositories?: Array<{ full_name?: string; name?: string }>;
  }>('/installation/repositories', accessToken);
  const repos = json.repositories ?? [];
  const upstreamName = REPO_SLUG.split('/')[1];
  const match = repos.find((r) => r.name === upstreamName);
  const picked = match ?? repos[0];
  if (!picked?.full_name) {
    throw new Error('no repositories visible to this installation');
  }
  return picked.full_name;
}

async function ghJson<T>(
  path: string,
  accessToken: string,
  init?: { method?: string; body?: string }
): Promise<T> {
  const url = path.startsWith('http') ? path : `${GH_API}${path}`;
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': `image-lp-builder/${CURRENT_VERSION}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body,
  });
  if (!res.ok) {
    const detail = (await safeText(res)).slice(0, 200);
    throw new Error(`${init?.method ?? 'GET'} ${path} ${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<no body>';
  }
}
