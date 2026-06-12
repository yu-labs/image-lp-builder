/**
 * Authentication middleware
 *
 * Runs on every request before route handlers.
 * - Authenticates admin via Google OAuth session cookie (production)
 *   or a fixed dev admin (localhost).
 * - Populates Astro.locals.user with the resolved admin row.
 * - Redirects unauthenticated /admin/* visitors to /admin/login.
 * - Returns 401 JSON for unauthenticated /api/* hits.
 *
 * Protected paths: /admin/*, /api/*
 * Public-but-under-admin: /admin/login, /admin/auth/start,
 *   /admin/auth/callback, /admin/logout (carved out so the OAuth
 *   round-trip can complete).
 * Public paths: /, /<slug> (public LPs), /go/*, /preview/*
 */

import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { isAdminPublicPath, requiresAuth } from './lib/auth';
import { errors } from './lib/api';
import { runPendingMigrations } from './lib/migrations';
import { revertCustomerHeadToParent } from './lib/github-revert';
import { resolveWorkspace } from './lib/workspace';
import { siteMetaQueries } from './lib/db';
import {
  readAdminSessionCookie,
  verifyAdminSession,
} from './lib/admin-session';
import { getOrCreateDevAdmin } from './lib/admin-auth';
import { isInProgress, markFailed, readLock } from './lib/update-lock';
import { isLocalDevHostname } from './lib/local-dev';
import { CURRENT_VERSION } from './lib/version';

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // Backward-compat 301: self-hosters may have shared `/lp-*` URLs (QR
  // codes, business cards, ad campaigns) before the route prefix was
  // removed. Forward the visitor to the new path so those links
  // keep working. Runs before auth / migrations because the old paths
  // no longer exist as routes — without this short-circuit they'd
  // 404 instead.
  const legacyTarget = legacyRouteRedirect(pathname, url.search);
  if (legacyTarget) {
    return new Response(null, {
      status: 301,
      headers: { Location: legacyTarget, 'Cache-Control': 'public, max-age=3600' },
    });
  }

  // Initialize user as null
  context.locals.user = null;
  // Resolve the workspace for this request (constant 'default' for
  // now). Both protected and public routes see a non-null value so
  // db helpers can rely on it.
  context.locals.workspace_id = resolveWorkspace();
  // Astro v6 + wrangler dev doesn't reliably set import.meta.env.DEV,
  // so local development is detected from the request host. This value
  // also gates local-only cleanup of stale pre-publication D1 state.
  const isDev = isLocalDevHostname(url.hostname);

  // Auto-apply schema migrations on the first request handled by
  // each isolate. This is what lets a non-technical self-hoster click
  // "Deploy to Cloudflare" and have a working database without ever
  // running wrangler. Memoised inside runPendingMigrations.
  //
  // If migration fails *and* a self-update lock is held (we're inside
  // the bank-transaction window), this isolate is the freshly
  // deployed Worker that booted with new code on top of an
  // incompatible schema attempt. runPendingMigrations already rolled
  // the DB back via each migration's DOWN section; we still need to
  // push the GitHub HEAD back to its parent so Cloudflare rebuilds
  // with the previous code and swaps this broken isolate out. The
  // revert is best-effort: API failures get logged and the operator
  // sees the failure UI either way.
  if (env?.DB) {
    try {
      await runPendingMigrations(env.DB, {
        repairLegacyLocalBaseline: isDev,
      });
    } catch (err) {
      console.error('Migration check failed:', err);
      if (env?.RATE_LIMIT) {
        await handleMigrationFailureDuringUpdate(
          env.DB,
          env.RATE_LIMIT,
          context.locals.workspace_id,
          env?.OAUTH_RELAY_URL,
          err
        );
      }
      // Don't bring down the whole site over a migration error —
      // log and let the request proceed; routes that hit missing
      // tables will surface a clearer error to the operator.
    }
  }

  // workers.dev kill switch: when the self-hoster flips
  // workers_dev_disabled on, every request that landed on a
  // *.workers.dev host gets 301'd to lp.{domain}/{same path}. Public
  // LPs, /admin, /api, /go, /preview — the lot. The point is that
  // the self-hoster can decide "I'm consolidated on lp.{domain} now,
  // anyone still bookmarking the workers.dev URL should just be
  // forwarded once and never see it again." Path + query are
  // preserved so deep links don't break.
  if (env?.DB && url.hostname.endsWith('.workers.dev')) {
    try {
      const siteMeta = await siteMetaQueries.get(env.DB, context.locals.workspace_id);
      const targetDomain = siteMeta?.domain?.trim();
      if (siteMeta?.workers_dev_disabled === 1 && targetDomain) {
        return new Response(null, {
          status: 301,
          headers: {
            Location: `https://lp.${targetDomain}${pathname}${url.search}`,
            // Long-cache the redirect so repeat visits from the
            // legacy host don't keep hitting D1 just to learn the
            // same answer. Self-hosters re-enabling workers.dev will
            // see the redirect linger for an hour, which is fine.
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    } catch (err) {
      // Don't 500 the request over a kill-switch lookup failure —
      // fall through and serve the workers.dev URL as if the toggle
      // were off. Logged for the operator to investigate.
      console.error('workers.dev kill-switch lookup failed:', err);
    }
  }

  // Skip auth for public paths — but still attach the security
  // headers below to harden every response.
  if (!requiresAuth(pathname)) {
    const response = await next();
    applySecurityHeaders(response);
    return response;
  }

  // Get database binding from cloudflare:workers
  if (!env?.DB) {
    // Database not available (configuration issue)
    return errors.internalError('Database not configured');
  }

  try {
    if (isDev) {
      // Bypass OAuth entirely on localhost. Lazily creates the dev
      // admin row so a fresh database doesn't land the developer on
      // /admin/login on every cold start.
      const devAdmin = await getOrCreateDevAdmin(
        env.DB,
        context.locals.workspace_id
      );
      context.locals.user = {
        id: devAdmin.id,
        email: devAdmin.email,
        role: devAdmin.role,
        created_at: devAdmin.created_at,
        last_login_at: devAdmin.last_login_at,
      };
    } else {
      const sessionToken = readAdminSessionCookie(
        context.request.headers.get('cookie')
      );
      const found = sessionToken
        ? await verifyAdminSession(env.DB, sessionToken)
        : null;

      if (!found) {
        // Authentication failed for a protected route.
        if (pathname === '/api' || pathname.startsWith('/api/')) {
          return errors.unauthorized();
        }
        // For admin pages, redirect to /admin/login (preserving the
        // intended destination so the user lands back where they
        // tried to go).
        const loginUrl = new URL('/admin/login', url);
        loginUrl.searchParams.set(
          'redirect_to',
          `${pathname}${url.search}`
        );
        return new Response(null, {
          status: 302,
          headers: { Location: loginUrl.toString() },
        });
      }

      context.locals.user = {
        id: found.user.id,
        email: found.user.email,
        role: found.user.role,
        created_at: found.user.created_at,
        last_login_at: found.user.last_login_at,
      };
    }
  } catch (err) {
    console.error('Authentication error:', err);
    return errors.internalError('Authentication failed');
  }

  // Self-update lock: while a /admin/update run is in progress, every
  // other /admin/* page redirects to /admin/update so the operator
  // can't edit LP content or settings mid-deploy. /api/* is left
  // alone — the polling UI on /admin/update needs to call /api/version,
  // /api/admin/update/status, and /api/admin/update/release while the
  // lock is held. /admin/update itself (and its install round-trip)
  // are exempted to avoid a redirect loop.
  if (
    env?.RATE_LIMIT &&
    (pathname === '/admin' || pathname.startsWith('/admin/')) &&
    pathname !== '/admin/update' &&
    !pathname.startsWith('/admin/update/')
  ) {
    try {
      const lock = await readLock(env.RATE_LIMIT, context.locals.workspace_id);
      if (isInProgress(lock)) {
        return new Response(null, {
          status: 302,
          headers: { Location: '/admin/update' },
        });
      }
    } catch (err) {
      // Fail open: a transient KV read error shouldn't lock the
      // operator out. The /admin/update page will read the lock
      // again and surface the right state.
      console.error('update lock check failed:', err);
    }
  }

  const response = await next();
  applySecurityHeaders(response);
  return response;
});

// Re-exported so the OAuth callback route (which has to short-circuit
// the middleware once it issues a session) can also tag its responses.
// Other modules outside this file shouldn't need to call it.
export function isAdminPublic(pathname: string): boolean {
  return isAdminPublicPath(pathname);
}

/**
 * Map old `/lp-*` paths to their post-rename equivalents. Returns the
 * full target (path + query) for a 301, or null when the request is
 * already on a current path.
 *
 * The mapping is mechanical, so it stays in middleware rather than
 * needing a route handler per legacy prefix:
 *
 *   /lp/<slug>            -> /<slug>
 *   /lp-admin             -> /admin
 *   /lp-admin/...         -> /admin/...
 *   /lp-api/...           -> /api/...
 *   /lp-c/...             -> /go/...
 *   /lp-preview/...       -> /preview/...
 *
 * `search` includes the leading `?` when present (or an empty
 * string), matching `URL#search`'s convention so the caller can
 * concatenate without conditionals.
 */
/**
 * Called when runPendingMigrations throws. If the workspace is
 * currently in a self-update window (lock held with a non-failed
 * stage), assume this isolate is the freshly deployed Worker that
 * just rolled its own DB changes back via DOWN sections, and try to
 * push the GitHub HEAD back to its parent so Cloudflare rebuilds
 * with the previous code. Marks the lock 'failed' either way — the
 * polling loop on /admin/update keys off that to surface the error.
 *
 * Errors here are intentionally swallowed: the request that
 * triggered migration check can still proceed (it'll likely fail at
 * the route level, but the operator at least sees a server response
 * instead of a 500 from middleware).
 */
async function handleMigrationFailureDuringUpdate(
  db: D1Database,
  kv: KVNamespace,
  workspaceId: string,
  relayUrlOverride: string | undefined,
  originalError: unknown
): Promise<void> {
  try {
    const lock = await readLock(kv, workspaceId);
    if (!lock || lock.stage === 'failed') {
      // No self-update in flight — migration failed for some other
      // reason (manual deploy, schema drift). Don't push a revert,
      // just leave the failure state as-is for the operator.
      return;
    }
    const errMsg =
      originalError instanceof Error
        ? originalError.message
        : String(originalError);
    const revert = await revertCustomerHeadToParent({
      db,
      workspaceId,
      relayUrlOverride,
    });
    const failureMessage =
      revert.status === 'reverted'
        ? `データベースの更新に失敗したためロールバックしました。GitHub も元のバージョンに巻き戻しています(${errMsg.slice(0, 80)}…)。`
        : revert.status === 'no_install'
          ? 'データベースの更新に失敗しました。GitHub App の連携情報がないため自動巻き戻しはできません。手動で前のリリースに戻してください。'
          : `データベースの更新に失敗しました。自動巻き戻しに失敗(${revert.message.slice(0, 80)})。GitHub と Cloudflare の状態を確認してください。`;
    await markFailed(kv, workspaceId, failureMessage);
  } catch (markErr) {
    console.error('handleMigrationFailureDuringUpdate threw:', markErr);
  }
}

function legacyRouteRedirect(
  pathname: string,
  search: string
): string | null {
  // /lp/<slug> -> /<slug>
  if (pathname.startsWith('/lp/')) {
    return `${pathname.slice(3)}${search}`;
  }
  const prefixMap: Array<[string, string]> = [
    ['/lp-admin', '/admin'],
    ['/lp-api', '/api'],
    ['/lp-c', '/go'],
    ['/lp-preview', '/preview'],
  ];
  for (const [oldPrefix, newPrefix] of prefixMap) {
    if (pathname === oldPrefix) {
      return `${newPrefix}${search}`;
    }
    if (pathname.startsWith(`${oldPrefix}/`)) {
      return `${newPrefix}${pathname.slice(oldPrefix.length)}${search}`;
    }
  }
  return null;
}

/**
 * Attach baseline security headers to every response.
 *
 * We deliberately don't ship a strict Content-Security-Policy: the
 * builder lets self-hosters paste arbitrary HTML into the tracking-tags
 * box (their own GTM / Pixel snippets), which would conflict with a
 * tight script-src list. The headers below are the "safe" subset
 * that hardens the response without breaking any existing feature.
 *
 * - X-Content-Type-Options: prevents MIME sniffing.
 * - X-Frame-Options: blocks third-party iframes (clickjacking) while
 *   still allowing same-origin (the admin preview iframe).
 * - Referrer-Policy: trims referrer for cross-origin navigation.
 * - Permissions-Policy: turns off browser APIs LPs never need.
 * - X-Image-LP-Builder-Version: identifies this response as coming from an
 *   image-lp-builder Worker. The domain settings panel pings
 *   lp.{domain} during a save and uses this header to tell apart
 *   "you wired it up correctly" from "lp.{domain} is hosted by
 *   something else entirely." Bumped together with package.json so
 *   the value also doubles as a build-version probe.
 */
function applySecurityHeaders(response: Response): void {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
  );
  response.headers.set('X-Image-LP-Builder-Version', IMAGE_LP_BUILDER_VERSION);
}

const IMAGE_LP_BUILDER_VERSION = CURRENT_VERSION;
