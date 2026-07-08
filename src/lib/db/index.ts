/**
 * Database helpers for Cloudflare D1
 * Provides typed access to the database from API routes and pages.
 *
 * LP storage is layered into three tables (see migration 0001):
 *
 *   pages          — the LP "box": URL/slug, display settings,
 *                    scheduling, password gate, and pointers into the
 *                    other two tables. Does NOT carry LP body JSON.
 *   page_versions  — snapshots of LP body JSON (sections, CTAs,
 *                    promotions). Draft rows become immutable
 *                    published_snapshot rows on publish; later edits
 *                    create a fresh draft based on the public snapshot.
 *   publications   — every publish / republish appends a row; the
 *                    currently-public row has status='active'.
 *
 * Workspace scoping (every editor-facing query takes a `workspaceId`)
 * applies to all three tables; helpers tied to public URL identifiers
 * — slug, preview_token, short_path — intentionally skip the
 * workspace filter because those identifiers are unique across the
 * whole table (so the public router can resolve them without knowing
 * the workspace).
 *
 * This module is a barrel re-export — one file per table (plus a
 * couple of shared helper modules) lives alongside this file. Import
 * from `'../lib/db'` (or `'./db'`) as before; nothing outside this
 * directory needs to know about the split.
 */

export { getDB } from './core';
export { generateId, generateShortPath } from './ids';
export { userQueries } from './users';

export {
  pageQueries,
  hasPagePendingChanges,
  isLiveNow,
  isPublicationEnded,
  type Page,
  type PageWithDraft,
  type PageWithPublished,
  type PagePublicSummary,
} from './pages';

export {
  pageVersionsQueries,
  type PageVersion,
} from './page-versions';

export {
  publicationsQueries,
  type Publication,
} from './publications';

export {
  siteSettingsQueries,
  type SiteSettings,
} from './site-settings';

export {
  myLinkQueries,
  type MyLink,
} from './my-links';

export {
  trackingTagsQueries,
  type TrackingTags,
} from './tracking-tags';

export {
  utmLinkQueries,
  type UtmLink,
} from './utm-links';

export {
  hubConnectorQueries,
  resolveHubConnectorScript,
  type HubConnectorStatus,
  type ResolvedHubConnector,
  type HubConnectorUpsertParams,
  type HubConnectorScriptDescriptor,
} from './hub-connector';

export {
  siteMetaQueries,
  type SiteMeta,
} from './site-meta';

export {
  adminUserQueries,
  type AdminUser,
} from './admin-users';

export {
  adminSessionQueries,
  type AdminSession,
} from './admin-sessions';
