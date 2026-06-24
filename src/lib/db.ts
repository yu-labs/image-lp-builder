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
 */

import { randomUUID } from './uuid';
import type { PageContent } from './content';

/**
 * Get the D1 database from Astro context.
 * Usage in pages: `const db = getDB(Astro.locals.runtime.env)`
 * Usage in API: `const db = getDB(locals.runtime.env)`
 */
export function getDB(env: Env): D1Database {
  return env.DB;
}

type PageRenderSettings = {
  maxWidth: number;
  backgroundColor: string | null;
  frameStyle: 'line' | 'shadow' | null;
};

const PUBLICATION_RENDER_SETTINGS_KEY = 'renderSettings';
const NEW_LP_CONTENT = '{"version":1,"sections":[],"meta":{"noindex":true}}';
const NEW_LP_PAGE_META = '{"hub_connector":{"enabled":true}}';

function pageRenderSettings(
  page: Pick<Page, 'max_width' | 'background_color' | 'frame_style'>
): PageRenderSettings {
  return {
    maxWidth: page.max_width,
    backgroundColor: page.background_color ?? null,
    frameStyle:
      page.frame_style === 'line' || page.frame_style === 'shadow'
        ? page.frame_style
        : null,
  };
}

function parsePublicationMeta(
  metaRaw: string | null | undefined
): Record<string, unknown> {
  if (!metaRaw) return {};
  try {
    const parsed: unknown = JSON.parse(metaRaw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readPublicationRenderSettings(
  metaRaw: string | null | undefined
): PageRenderSettings | null {
  const meta = parsePublicationMeta(metaRaw);
  const raw = meta[PUBLICATION_RENDER_SETTINGS_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const maxWidth = obj.maxWidth;
  if (typeof maxWidth !== 'number' || !Number.isFinite(maxWidth)) return null;
  const backgroundColor =
    typeof obj.backgroundColor === 'string' ? obj.backgroundColor : null;
  const frameStyle =
    obj.frameStyle === 'line' || obj.frameStyle === 'shadow'
      ? obj.frameStyle
      : null;
  return { maxWidth, backgroundColor, frameStyle };
}

function publicationMetaWithRenderSettings(
  metaRaw: string | null | undefined,
  page: Pick<Page, 'max_width' | 'background_color' | 'frame_style'>
): string {
  return JSON.stringify({
    ...parsePublicationMeta(metaRaw),
    [PUBLICATION_RENDER_SETTINGS_KEY]: pageRenderSettings(page),
  });
}

function applyPublishedRenderSettings<T extends Page>(
  page: T,
  publicationMeta: string | null | undefined
): T {
  const settings = readPublicationRenderSettings(publicationMeta);
  if (!settings) return page;
  return {
    ...page,
    max_width: settings.maxWidth,
    background_color: settings.backgroundColor,
    frame_style: settings.frameStyle,
  };
}

function duplicateContentForNewPage(rawContent: string): string {
  const parsed = JSON.parse(rawContent) as PageContent;
  const sections = Array.isArray(parsed.sections)
    ? parsed.sections.map((section) => ({
        ...section,
        id: randomUUID(),
        ctas: Array.isArray(section.ctas)
          ? section.ctas.map((cta) => ({ ...cta, id: randomUUID() }))
          : [],
      }))
    : [];

  return JSON.stringify({
    ...parsed,
    version: 1,
    sections,
    meta: { noindex: true },
    archived_sections: undefined,
  });
}

function sameRenderSettings(
  a: PageRenderSettings,
  b: PageRenderSettings
): boolean {
  return (
    a.maxWidth === b.maxWidth &&
    a.backgroundColor === b.backgroundColor &&
    a.frameStyle === b.frameStyle
  );
}

export function hasPagePendingChanges(page: PageWithDraft): boolean {
  if (page.status !== 'published') return false;
  if (page.live_content !== page.content) return true;
  const publishedSettings = readPublicationRenderSettings(
    page.active_publication_meta
  );
  if (!publishedSettings) return false;
  return !sameRenderSettings(pageRenderSettings(page), publishedSettings);
}

/**
 * User-related queries
 */
export const userQueries = {
  /**
   * Find user by email. Returns null if not found.
   */
  async findByEmail(db: D1Database, email: string): Promise<User | null> {
    const result = await db
      .prepare('SELECT * FROM users WHERE email = ?')
      .bind(email)
      .first<User>();
    return result ?? null;
  },

  /**
   * Create a new user. Returns the created user.
   */
  async create(
    db: D1Database,
    params: { id: string; email: string; role: 'owner' | 'editor' }
  ): Promise<User> {
    await db
      .prepare(
        `INSERT INTO users (id, email, role) VALUES (?, ?, ?)`
      )
      .bind(params.id, params.email, params.role)
      .run();

    const created = await this.findByEmail(db, params.email);
    if (!created) {
      throw new Error('Failed to create user');
    }
    return created;
  },

  /**
   * Update user's last_login_at timestamp.
   */
  async updateLastLogin(db: D1Database, userId: string): Promise<void> {
    await db
      .prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`)
      .bind(userId)
      .run();
  },

  /**
   * Count total users (used to detect first-time setup).
   */
  async count(db: D1Database): Promise<number> {
    const result = await db
      .prepare('SELECT COUNT(*) as count FROM users')
      .first<{ count: number }>();
    return result?.count ?? 0;
  },
};

/**
 * Page (LP) record from D1 — the box only, no body JSON.
 *
 * `current_draft_version_id` points at the live editable draft in
 * page_versions; `published_version_id` is the snapshot the public URL
 * currently serves (NULL when never published); `latest_publication_id`
 * is the active publications row for the LP.
 */
export interface Page {
  id: string;
  workspace_id: string;
  slug: string;
  title: string | null;
  status: 'draft' | 'published' | 'preview' | 'archived' | 'trash';
  current_draft_version_id: string | null;
  published_version_id: string | null;
  latest_publication_id: string | null;
  max_width: number;
  /** Hex color (e.g. "#f5f7fa") painted around the centred LP body.
   *  NULL = render the default white. */
  background_color: string | null;
  /** Decoration around the centred LP body: 'line' draws thin vertical
   *  lines on the left/right edges, 'shadow' applies a subtle drop
   *  shadow. NULL or 'none' = no decoration. */
  frame_style: 'line' | 'shadow' | 'none' | null;
  meta: string | null;
  custom_domain: string | null;
  password_hash: string | null;
  publish_at: string | null;
  unpublish_at: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  trashed_at: string | null;
  preview_token: string | null;
}

/**
 * Snapshot of LP body JSON. One row per draft / published snapshot.
 * `content` carries the full sections / CTAs / promotions structure.
 */
export interface PageVersion {
  id: string;
  workspace_id: string;
  page_id: string;
  version_number: number;
  status: 'draft' | 'published_snapshot' | 'archived';
  source: 'manual' | 'hub_connector' | 'duplicate' | 'restore';
  base_version_id: string | null;
  base_publication_id: string | null;
  label: string | null;
  content: string;
  /** Stable hash of `content`. Left NULL by these helpers; populated by
   *  the runtime layer once content-change detection lands. */
  content_hash: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Publication history row. `status='active'` is the row pages.latest_publication_id
 * points at; publish / republish flips the previous active row to
 * `status='ended'` before inserting a fresh active row.
 */
export interface Publication {
  id: string;
  workspace_id: string;
  page_id: string;
  version_id: string;
  status: 'active' | 'ended' | 'reverted';
  published_at: string;
  unpublished_at: string | null;
  created_by: string | null;
  source: 'manual' | 'hub_connector' | 'restore';
  label: string | null;
  meta: string | null;
}

/**
 * Compatibility shape returned by helpers that join the page row with
 * its current draft (and, for change detection, the currently
 * published snapshot). Lets runtime code still read `lp.content` /
 * `lp.live_content` until the editor / public renderer move onto the
 * three-layer API in builder-publication-runtime-03.
 */
export interface PageWithDraft extends Page {
  draft_version_id: string | null;
  active_publication_meta: string | null;
  /** Current draft version's content. Empty `'{}'` when an LP has no
   *  draft version yet (only possible mid-creation). */
  content: string;
  /** Currently-published snapshot's content. NULL when the LP has
   *  never been published. */
  live_content: string | null;
}

/**
 * Compatibility shape for the public URL — the page row joined with
 * its currently-published snapshot. `content` and `live_content` carry
 * the same value (the published snapshot) so existing renderer code
 * keeps type-checking until the runtime move-over.
 */
export interface PageWithPublished extends Page {
  published_version_id_resolved: string;
  content: string;
  live_content: string;
}

export interface PagePublicSummary {
  id: string;
  title: string | null;
  slug: string;
  status: 'published';
  publish_at: string | null;
  unpublish_at: string | null;
}

/**
 * Page-related queries.
 *
 * Reads come in three flavours:
 *   - `findById` returns only the page row (no body JSON). Use this
 *     when a route only needs metadata (settings, preview-token,
 *     publish status, etc.).
 *   - `findByIdWithDraft` joins page_versions and returns
 *     `PageWithDraft`. Use this on routes that render the editor or
 *     inspect the draft body.
 *   - `findBySlugWithPublishedVersion` joins on the published
 *     snapshot. Use this for the public URL.
 */
export const pageQueries = {
  /**
   * Find a page row by id within the given workspace. Returns null if
   * the LP doesn't exist or belongs to another workspace.
   */
  async findById(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<Page | null> {
    const result = await db
      .prepare(
        'SELECT * FROM pages WHERE id = ? AND workspace_id = ? LIMIT 1'
      )
      .bind(id, workspaceId)
      .first<Page>();
    return result ?? null;
  },

  /**
   * Page + current draft version + currently-published snapshot.
   * Used by routes that render the editor or compute "pending changes"
   * (draft.content vs published snapshot's content).
   */
  async findByIdWithDraft(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<PageWithDraft | null> {
    const row = await db
      .prepare(
        `SELECT
           p.*,
           d.id AS draft_version_id_resolved,
           d.content AS draft_content,
           pv.content AS published_content,
           latest_pub.meta AS active_publication_meta
         FROM pages p
         LEFT JOIN page_versions d ON d.id = p.current_draft_version_id
         LEFT JOIN publications latest_pub ON latest_pub.id = p.latest_publication_id
         LEFT JOIN page_versions pv
           ON pv.id = COALESCE(p.published_version_id, latest_pub.version_id)
         WHERE p.id = ? AND p.workspace_id = ?
         LIMIT 1`
      )
      .bind(id, workspaceId)
      .first<
        Page & {
          draft_version_id_resolved: string | null;
          draft_content: string | null;
          published_content: string | null;
          active_publication_meta: string | null;
        }
      >();
    if (!row) return null;
    return hydrateWithDraft(row);
  },

  /**
   * Find the published LP by slug for the public URL. Skips the
   * workspace filter because slugs are unique across the whole table.
   * Returns null when the LP doesn't exist, isn't currently
   * published, or has no published snapshot wired up.
   */
  async findBySlugWithPublishedVersion(
    db: D1Database,
    slug: string
  ): Promise<PageWithPublished | null> {
    const row = await db
      .prepare(
        `SELECT
           p.*,
           COALESCE(pub.version_id, p.published_version_id) AS published_version_id_resolved,
           pv.content AS published_content,
           pub.meta AS publication_meta
         FROM pages p
         LEFT JOIN publications pub ON pub.id = p.latest_publication_id
         LEFT JOIN page_versions pv
           ON pv.id = COALESCE(pub.version_id, p.published_version_id)
         WHERE p.slug = ? AND p.status = 'published'
         LIMIT 1`
      )
      .bind(slug)
      .first<
        Page & {
          published_version_id_resolved: string | null;
          published_content: string | null;
          publication_meta: string | null;
        }
      >();
    if (!row) return null;
    const publishedVersionId = row.published_version_id_resolved;
    const content = row.published_content;
    if (publishedVersionId === null || content === null) {
      return null;
    }
    const {
      published_version_id_resolved: _dropVersionId,
      published_content: _dropContent,
      publication_meta,
      ...page
    } = row;
    const publishedPage = applyPublishedRenderSettings(
      page as Page,
      publication_meta
    );
    return {
      ...publishedPage,
      published_version_id_resolved: publishedVersionId,
      content,
      live_content: content,
    };
  },

  async findEndedBySlug(db: D1Database, slug: string): Promise<Page | null> {
    const result = await db
      .prepare(
        `SELECT *
         FROM pages
         WHERE slug = ?
           AND status != 'trash'
           AND latest_publication_id IS NOT NULL
         LIMIT 1`
      )
      .bind(slug)
      .first<Page>();
    return result ?? null;
  },

  /**
   * List LPs in the workspace (excluding trash), joined with their
   * current draft so the admin grid can pull a thumbnail out of the
   * body JSON. Ordered by updated_at DESC.
   */
  async listAll(
    db: D1Database,
    workspaceId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<PageWithDraft[]> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    const result = await db
      .prepare(
        `SELECT
           p.*,
           d.id AS draft_version_id_resolved,
           d.content AS draft_content,
           pv.content AS published_content
         FROM pages p
         LEFT JOIN page_versions d ON d.id = p.current_draft_version_id
         LEFT JOIN publications latest_pub ON latest_pub.id = p.latest_publication_id
         LEFT JOIN page_versions pv
           ON pv.id = COALESCE(p.published_version_id, latest_pub.version_id)
         WHERE p.workspace_id = ? AND p.status != 'trash'
         ORDER BY p.updated_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(workspaceId, limit, offset)
      .all<Page & {
        draft_version_id_resolved: string | null;
        draft_content: string | null;
        published_content: string | null;
      }>();

    return (result.results ?? []).map(hydrateWithDraft);
  },

  async listLivePublishedSummaries(
    db: D1Database,
    workspaceId: string
  ): Promise<PagePublicSummary[]> {
    const result = await db
      .prepare(
        `SELECT
           p.id,
           p.title,
           p.slug,
           p.status,
           p.publish_at,
           p.unpublish_at,
           COALESCE(pub.version_id, p.published_version_id) AS published_version_id_resolved
         FROM pages p
         LEFT JOIN publications pub ON pub.id = p.latest_publication_id
         WHERE p.workspace_id = ? AND p.status = 'published'
         ORDER BY p.updated_at DESC`
      )
      .bind(workspaceId)
      .all<
        PagePublicSummary & {
          published_version_id_resolved: string | null;
        }
      >();

    return (result.results ?? [])
      .filter((row) => row.published_version_id_resolved && isLiveNow(row))
      .map(({ published_version_id_resolved: _drop, ...row }) => row);
  },

  async findLivePublishedById(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<Page | null> {
    const row = await db
      .prepare(
        `SELECT
           p.*,
           COALESCE(pub.version_id, p.published_version_id) AS published_version_id_resolved
         FROM pages p
         LEFT JOIN publications pub ON pub.id = p.latest_publication_id
         WHERE p.id = ? AND p.workspace_id = ? AND p.status = 'published'
         LIMIT 1`
      )
      .bind(id, workspaceId)
      .first<
        Page & {
          published_version_id_resolved: string | null;
        }
      >();

    if (!row || !row.published_version_id_resolved || !isLiveNow(row)) {
      return null;
    }
    const { published_version_id_resolved: _drop, ...page } = row;
    return page;
  },

  /**
   * Count total LPs in the workspace (excluding trash) for pagination.
   */
  async countAll(db: D1Database, workspaceId: string): Promise<number> {
    const result = await db
      .prepare(
        `SELECT COUNT(*) as count FROM pages
         WHERE workspace_id = ? AND status != 'trash'`
      )
      .bind(workspaceId)
      .first<{ count: number }>();
    return result?.count ?? 0;
  },

  /**
   * Check whether an LP with the given slug already exists. Considers
   * every status (draft / published / archived) to prevent collisions
   * when a draft is later published.
   */
  async existsBySlug(db: D1Database, slug: string): Promise<boolean> {
    const result = await db
      .prepare('SELECT 1 FROM pages WHERE slug = ? LIMIT 1')
      .bind(slug)
      .first<{ '1': number }>();
    return result !== null;
  },

  /**
   * Same slug-existence check as POST /api/lps but excluding the
   * given LP id (so a slug "rename" to its current value doesn't
   * trip the uniqueness check).
   */
  async existsBySlugExcept(
    db: D1Database,
    slug: string,
    excludeId: string
  ): Promise<boolean> {
    const result = await db
      .prepare(
        `SELECT 1 FROM pages WHERE slug = ? AND id != ? LIMIT 1`
      )
      .bind(slug, excludeId)
      .first<{ '1': number }>();
    return result !== null;
  },

  /**
   * Create a new LP. Inserts a pages row, creates the first draft
   * page_versions row (version_number=1, status='draft'), and wires
   * the pointer. Caller must have validated `slug` already.
   */
  async create(
    db: D1Database,
    workspaceId: string,
    params: { id: string; slug: string; title?: string | null }
  ): Promise<Page> {
    const draftId = randomUUID();
    await db.batch([
      db
        .prepare(
          `INSERT INTO pages (id, workspace_id, slug, title, status, max_width, meta)
           VALUES (?, ?, ?, ?, 'draft', 750, ?)`
        )
        .bind(
          params.id,
          workspaceId,
          params.slug,
          params.title ?? null,
          NEW_LP_PAGE_META
        ),
      db
        .prepare(
          `INSERT INTO page_versions
             (id, workspace_id, page_id, version_number, status, source, content)
           VALUES (?, ?, ?, 1, 'draft', 'manual', ?)`
        )
        .bind(draftId, workspaceId, params.id, NEW_LP_CONTENT),
      db
        .prepare(
          `UPDATE pages SET current_draft_version_id = ?
           WHERE id = ? AND workspace_id = ?`
        )
        .bind(draftId, params.id, workspaceId),
    ]);

    const created = await this.findById(db, workspaceId, params.id);
    if (!created) {
      throw new Error('Failed to create LP');
    }
    return created;
  },

  /**
   * Duplicate an existing LP into a fresh draft.
   *
   * Carries the structural / visual side of the source LP — sections,
   * CTAs, promotions, max_width, background_color, frame_style — so
   * the operator can reuse a proven layout for the next campaign
   * without rebuilding from scratch.
   *
   * Resets every operational / per-campaign field so the new LP
   * starts in a known-safe state:
   *   - status = 'draft' (never instantly publishes a half-baked copy)
   *   - meta (title / description / OGP) reset; search display defaults OFF
   *   - LP-level connector flag defaults ON
   *   - archived_sections cleared (start with a clean slate)
   *   - password / publish schedule / preview_token / custom_domain → null
   *   - published_version_id / latest_publication_id stay NULL
   *   - utm_links table is intentionally NOT copied (campaign-level
   *     identifiers should be re-issued per campaign)
   *
   * Caller validates `newSlug` (format, reserved, uniqueness).
   */
  async duplicate(
    db: D1Database,
    workspaceId: string,
    sourceId: string,
    params: { id: string; slug: string }
  ): Promise<Page | null> {
    const source = await this.findByIdWithDraft(db, workspaceId, sourceId);
    if (!source) return null;

    // Strip campaign-specific meta + archived_sections from the source
    // draft's content before copying. New LPs default to noindex so
    // operators explicitly opt in when they want search visibility.
    let nextContent: string;
    try {
      nextContent = duplicateContentForNewPage(source.content);
    } catch {
      nextContent = NEW_LP_CONTENT;
    }

    const draftId = randomUUID();
    const baseVersionId = source.draft_version_id ?? source.published_version_id;
    const basePublicationId = source.latest_publication_id;
    const duplicatedTitle = await nextDuplicateTitle(
      db,
      workspaceId,
      source.title?.trim() || source.slug
    );
    await db.batch([
      db
        .prepare(
          `INSERT INTO pages (
             id, workspace_id, slug, title, status, max_width,
             background_color, frame_style, meta
           ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
        )
        .bind(
          params.id,
          workspaceId,
          params.slug,
          duplicatedTitle,
          source.max_width,
          source.background_color,
          source.frame_style,
          NEW_LP_PAGE_META
        ),
      db
        .prepare(
          `INSERT INTO page_versions
             (id, workspace_id, page_id, version_number, status,
              source, base_version_id, base_publication_id, content)
           VALUES (?, ?, ?, 1, 'draft', 'duplicate', ?, ?, ?)`
        )
        .bind(
          draftId,
          workspaceId,
          params.id,
          baseVersionId,
          basePublicationId,
          nextContent
        ),
      db
        .prepare(
          `UPDATE pages SET current_draft_version_id = ?
           WHERE id = ? AND workspace_id = ?`
        )
        .bind(draftId, params.id, workspaceId),
    ]);

    return this.findById(db, workspaceId, params.id);
  },

  /**
   * Write a new body to the LP's current draft version. `content` must
   * already be a JSON-serialized string. Bumps `updated_at` on both
   * the page row and the draft version. Returns null when the LP is
   * missing. If a published/archived LP has no draft wired up, create
   * the next draft version from the public/latest publication lineage.
   */
  async updateContent(
    db: D1Database,
    workspaceId: string,
    id: string,
    content: string
  ): Promise<Page | null> {
    const page = await this.findById(db, workspaceId, id);
    if (!page) return null;

    if (!page.current_draft_version_id) {
      const draftId = randomUUID();
      const nextVersionNumber = await this._nextVersionNumber(db, id);
      let baseVersionId = page.published_version_id;
      if (!baseVersionId && page.latest_publication_id) {
        const latestPublication = await publicationsQueries.findById(
          db,
          workspaceId,
          page.latest_publication_id
        );
        baseVersionId = latestPublication?.version_id ?? null;
      }

      await db.batch([
        db
          .prepare(
            `INSERT INTO page_versions
               (id, workspace_id, page_id, version_number, status, source,
                base_version_id, base_publication_id, content)
             VALUES (?, ?, ?, ?, 'draft', 'manual', ?, ?, ?)`
          )
          .bind(
            draftId,
            workspaceId,
            id,
            nextVersionNumber,
            baseVersionId,
            page.latest_publication_id,
            content
          ),
        db
          .prepare(
            `UPDATE pages
             SET current_draft_version_id = ?, updated_at = datetime('now')
             WHERE id = ? AND workspace_id = ?`
          )
          .bind(draftId, id, workspaceId),
      ]);

      return this.findById(db, workspaceId, id);
    }

    await db.batch([
      db
        .prepare(
          `UPDATE page_versions
           SET content = ?, updated_at = datetime('now')
           WHERE id = ? AND workspace_id = ?`
        )
        .bind(content, page.current_draft_version_id, workspaceId),
      db
        .prepare(
          `UPDATE pages SET updated_at = datetime('now')
           WHERE id = ? AND workspace_id = ?`
        )
        .bind(id, workspaceId),
    ]);

    return this.findById(db, workspaceId, id);
  },

  /**
   * Bring in a new draft from the Hub Connector import API.
   *
   * Archives any existing draft row for the page (so there's only
   * one current draft after the import), inserts a fresh
   * `page_versions` row with `status='draft'` and
   * `source='hub_connector'`, and re-points
   * `pages.current_draft_version_id` at it.
   *
   * `published_version_id` and `latest_publication_id` are deliberately
   * untouched — Hub imports must never mutate the currently-public
   * snapshot. The new draft's `base_version_id` /
   * `base_publication_id` are set to the LP's published lineage so a
   * later publish path can still trace where the draft came from.
   *
   * Returns null when the page doesn't exist (workspace mismatch or
   * unknown id).
   */
  async importHubConnectorDraft(
    db: D1Database,
    workspaceId: string,
    pageId: string,
    content: string
  ): Promise<{ page: Page; draftVersion: PageVersion } | null> {
    const page = await this.findById(db, workspaceId, pageId);
    if (!page) return null;

    const draftId = randomUUID();
    const versionNumber = await this._nextVersionNumber(db, pageId);
    const baseVersionId = page.published_version_id;
    const basePublicationId = page.latest_publication_id;

    await db.batch([
      db
        .prepare(
          `UPDATE page_versions
           SET status = 'archived', updated_at = datetime('now')
           WHERE page_id = ? AND workspace_id = ? AND status = 'draft'`
        )
        .bind(pageId, workspaceId),
      db
        .prepare(
          `INSERT INTO page_versions
             (id, workspace_id, page_id, version_number, status, source,
              base_version_id, base_publication_id, content)
           VALUES (?, ?, ?, ?, 'draft', 'hub_connector', ?, ?, ?)`
        )
        .bind(
          draftId,
          workspaceId,
          pageId,
          versionNumber,
          baseVersionId,
          basePublicationId,
          content
        ),
      db
        .prepare(
          `UPDATE pages
           SET current_draft_version_id = ?, updated_at = datetime('now')
           WHERE id = ? AND workspace_id = ?`
        )
        .bind(draftId, pageId, workspaceId),
    ]);

    const updatedPage = await this.findById(db, workspaceId, pageId);
    const draftVersion = await pageVersionsQueries.findById(
      db,
      workspaceId,
      draftId
    );
    if (!updatedPage || !draftVersion) {
      throw new Error('Failed to read back imported draft');
    }
    return { page: updatedPage, draftVersion };
  },

  /**
   * Move the LP from draft / preview / archived to published.
   *
   * Freezes the current draft as a `published_snapshot`, creates an
   * active publications row, clears current_draft_version_id, and
   * updates pages.published_version_id / latest_publication_id.
   * Preserves `published_at` on the page row after the first publish.
   */
  async publish(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<Page | null> {
    const page = await this.findByIdWithDraft(db, workspaceId, id);
    if (!page) return null;

    const publicationId = randomUUID();
    const publicationMeta = publicationMetaWithRenderSettings(null, page);

    if (!page.draft_version_id) {
      if (
        (page.status !== 'archived' && page.status !== 'draft') ||
        (!page.latest_publication_id && !page.published_version_id)
      ) {
        return null;
      }
      const latestPublication = page.latest_publication_id
        ? await publicationsQueries.findById(
            db,
            workspaceId,
            page.latest_publication_id
          )
        : null;
      const versionId = latestPublication?.version_id ?? page.published_version_id;
      if (!versionId) return null;

      await db.batch([
        db
          .prepare(
            `UPDATE publications
             SET status = 'ended', unpublished_at = datetime('now')
             WHERE page_id = ? AND workspace_id = ? AND status = 'active'`
          )
          .bind(id, workspaceId),
        db
          .prepare(
            `INSERT INTO publications
               (id, workspace_id, page_id, version_id, status, source, meta)
             VALUES (?, ?, ?, ?, 'active', 'restore', ?)`
          )
          .bind(
            publicationId,
            workspaceId,
            id,
            versionId,
            publicationMeta
          ),
        db
          .prepare(
            `UPDATE pages
             SET status = 'published',
                 published_version_id = ?,
                 latest_publication_id = ?,
                 published_at = COALESCE(published_at, datetime('now')),
                 updated_at = datetime('now')
             WHERE id = ? AND workspace_id = ?`
          )
          .bind(versionId, publicationId, id, workspaceId),
      ]);

      return this.findById(db, workspaceId, id);
    }

    await db.batch([
      // End any existing active publication for this page.
      db
        .prepare(
          `UPDATE publications
           SET status = 'ended', unpublished_at = datetime('now')
           WHERE page_id = ? AND workspace_id = ? AND status = 'active'`
        )
        .bind(id, workspaceId),
      // Freeze the current draft body as the published snapshot.
      db
        .prepare(
          `UPDATE page_versions
           SET status = 'published_snapshot', updated_at = datetime('now')
           WHERE id = ? AND workspace_id = ? AND status = 'draft'`
        )
        .bind(page.draft_version_id, workspaceId),
      // Open the publication.
      db
        .prepare(
          `INSERT INTO publications
             (id, workspace_id, page_id, version_id, status, source, meta)
           VALUES (?, ?, ?, ?, 'active', 'manual', ?)`
        )
        .bind(
          publicationId,
          workspaceId,
          id,
          page.draft_version_id,
          publicationMeta
        ),
      // Wire pointers and flip status.
      db
        .prepare(
          `UPDATE pages
           SET status = 'published',
               published_version_id = ?,
               latest_publication_id = ?,
               current_draft_version_id = NULL,
               published_at = COALESCE(published_at, datetime('now')),
               updated_at = datetime('now')
           WHERE id = ? AND workspace_id = ?`
        )
        .bind(page.draft_version_id, publicationId, id, workspaceId),
    ]);

    return this.findById(db, workspaceId, id);
  },

  /**
   * Promote the working copy to the public snapshot for an already-
   * published LP. Ends the previous active publication, freezes the
   * current draft as `published_snapshot`, clears the draft pointer,
   * and opens a fresh active publication. Caller must have verified
   * the LP is currently `published`.
   */
  async republish(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<Page | null> {
    const page = await this.findByIdWithDraft(db, workspaceId, id);
    if (!page) return null;
    const versionId = page.draft_version_id ?? page.published_version_id;
    if (!versionId) return null;

    const publicationId = randomUUID();
    const publicationMeta = publicationMetaWithRenderSettings(null, page);

    const statements = [
      // End the previous active publication first so the partial
      // unique index `idx_publications_one_active_per_page` doesn't
      // reject the new active row.
      db
        .prepare(
          `UPDATE publications
           SET status = 'ended', unpublished_at = datetime('now')
           WHERE page_id = ? AND workspace_id = ? AND status = 'active'`
        )
        .bind(id, workspaceId),
      db
        .prepare(
          `INSERT INTO publications
             (id, workspace_id, page_id, version_id, status, source, meta)
           VALUES (?, ?, ?, ?, 'active', 'manual', ?)`
        )
        .bind(publicationId, workspaceId, id, versionId, publicationMeta),
      db
        .prepare(
          `UPDATE pages
           SET published_version_id = ?,
               latest_publication_id = ?,
               current_draft_version_id = NULL,
               updated_at = datetime('now')
           WHERE id = ? AND workspace_id = ?`
        )
        .bind(versionId, publicationId, id, workspaceId),
    ];
    if (page.draft_version_id) {
      statements.splice(
        1,
        0,
        db
          .prepare(
            `UPDATE page_versions
             SET status = 'published_snapshot', updated_at = datetime('now')
             WHERE id = ? AND workspace_id = ? AND status = 'draft'`
          )
          .bind(page.draft_version_id, workspaceId)
      );
    }
    await db.batch(statements);

    return this.findById(db, workspaceId, id);
  },

  /**
   * Move a published LP to archived. Ends the active publication
   * (kept in history for audit), clears the public version pointer,
   * and keeps latest_publication_id as the last-publication reference.
   * Caller must have checked the LP is currently published.
   */
  async unpublish(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<Page | null> {
    const page = await this.findById(db, workspaceId, id);
    if (!page) return null;

    await db.batch([
      db
        .prepare(
          `UPDATE publications
           SET status = 'ended', unpublished_at = datetime('now')
           WHERE page_id = ? AND workspace_id = ? AND status = 'active'`
        )
        .bind(id, workspaceId),
      db
        .prepare(
          `UPDATE pages
           SET status = 'archived',
               published_version_id = NULL,
               updated_at = datetime('now')
           WHERE id = ? AND workspace_id = ?`
        )
        .bind(id, workspaceId),
    ]);

    return this.findById(db, workspaceId, id);
  },

  /**
   * Update LP-level settings (title, slug, max_width, custom_domain,
   * scheduling, password). Slug uniqueness must be checked by the
   * caller before this is invoked. Returns the updated page or null
   * if no row was matched.
   */
  async updateSettings(
    db: D1Database,
    workspaceId: string,
    id: string,
    params: {
      title?: string;
      slug?: string;
      maxWidth?: number;
      customDomain?: string | null;
      publishAt?: string | null;
      unpublishAt?: string | null;
      passwordHash?: string | null;
      backgroundColor?: string | null;
      frameStyle?: 'line' | 'shadow' | 'none' | null;
      metaJson?: string | null;
    }
  ): Promise<Page | null> {
    const fields: string[] = [];
    const binds: (string | number | null)[] = [];

    if (params.title !== undefined) {
      fields.push('title = ?');
      binds.push(params.title);
    }
    if (params.slug !== undefined) {
      fields.push('slug = ?');
      binds.push(params.slug);
    }
    if (params.maxWidth !== undefined) {
      fields.push('max_width = ?');
      binds.push(params.maxWidth);
    }
    if (params.customDomain !== undefined) {
      fields.push('custom_domain = ?');
      binds.push(params.customDomain);
    }
    if (params.publishAt !== undefined) {
      fields.push('publish_at = ?');
      binds.push(params.publishAt);
    }
    if (params.unpublishAt !== undefined) {
      fields.push('unpublish_at = ?');
      binds.push(params.unpublishAt);
    }
    if (params.passwordHash !== undefined) {
      fields.push('password_hash = ?');
      binds.push(params.passwordHash);
    }
    if (params.backgroundColor !== undefined) {
      fields.push('background_color = ?');
      binds.push(params.backgroundColor);
    }
    if (params.frameStyle !== undefined) {
      fields.push('frame_style = ?');
      binds.push(params.frameStyle);
    }
    if (params.metaJson !== undefined) {
      fields.push('meta = ?');
      binds.push(params.metaJson);
    }

    if (fields.length === 0) return this.findById(db, workspaceId, id);

    fields.push("updated_at = datetime('now')");
    binds.push(id, workspaceId);

    const result = await db
      .prepare(
        `UPDATE pages SET ${fields.join(', ')}
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(...binds)
      .run();

    if (result.meta.changes === 0) return null;
    return this.findById(db, workspaceId, id);
  },

  /**
   * Find an LP by preview token, joined with its current draft so
   * the preview URL renders the working copy. Workspace-agnostic
   * because tokens are unique across the table.
   */
  async findByPreviewToken(
    db: D1Database,
    token: string
  ): Promise<PageWithDraft | null> {
    const row = await db
      .prepare(
        `SELECT
           p.*,
           d.id AS draft_version_id_resolved,
           d.content AS draft_content,
           pv.content AS published_content
         FROM pages p
         LEFT JOIN page_versions d ON d.id = p.current_draft_version_id
         LEFT JOIN publications latest_pub ON latest_pub.id = p.latest_publication_id
         LEFT JOIN page_versions pv
           ON pv.id = COALESCE(p.published_version_id, latest_pub.version_id)
         WHERE p.preview_token = ?
         LIMIT 1`
      )
      .bind(token)
      .first<Page & {
        draft_version_id_resolved: string | null;
        draft_content: string | null;
        published_content: string | null;
      }>();
    if (!row) return null;
    return hydrateWithDraft(row);
  },

  /**
   * Issue (or rotate) the preview token for an LP. Pass `null` to
   * revoke. Returns the updated page or null if no row was matched.
   */
  async setPreviewToken(
    db: D1Database,
    workspaceId: string,
    id: string,
    token: string | null
  ): Promise<Page | null> {
    const result = await db
      .prepare(
        `UPDATE pages SET preview_token = ?, updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(token, id, workspaceId)
      .run();
    if (result.meta.changes === 0) return null;
    return this.findById(db, workspaceId, id);
  },

  /**
   * List LPs currently in trash, newest-first by trashed_at. Joins
   * draft/published content so the admin trash UI can show thumbnails.
   */
  async listTrash(db: D1Database, workspaceId: string): Promise<PageWithDraft[]> {
    const result = await db
      .prepare(
        `SELECT
           p.*,
           d.id AS draft_version_id_resolved,
           d.content AS draft_content,
           pv.content AS published_content
         FROM pages p
         LEFT JOIN page_versions d ON d.id = p.current_draft_version_id
         LEFT JOIN publications latest_pub ON latest_pub.id = p.latest_publication_id
         LEFT JOIN page_versions pv
           ON pv.id = COALESCE(p.published_version_id, latest_pub.version_id)
         WHERE p.status = 'trash' AND p.workspace_id = ?
         ORDER BY trashed_at DESC`
      )
      .bind(workspaceId)
      .all<Page & {
        draft_version_id_resolved: string | null;
        draft_content: string | null;
        published_content: string | null;
      }>();
    return (result.results ?? []).map(hydrateWithDraft);
  },

  /**
   * Restore a trashed LP back to draft so it shows up in the regular
   * LP list again. If the LP was deleted while published, it usually
   * has no editable draft; recreate one from the latest published
   * snapshot so "restore -> publish" works without forcing a save.
   * Clears trashed_at. No-op (returns null) if the row isn't currently
   * in trash.
   */
  async restore(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<Page | null> {
    const page = await this.findById(db, workspaceId, id);
    if (!page || page.status !== 'trash') return null;

    if (page.current_draft_version_id) {
      const result = await db
        .prepare(
          `UPDATE pages
           SET status = 'draft',
               trashed_at = NULL,
               updated_at = datetime('now')
           WHERE id = ? AND workspace_id = ? AND status = 'trash'`
        )
        .bind(id, workspaceId)
        .run();
      if (result.meta.changes === 0) return null;
      return this.findById(db, workspaceId, id);
    }

    let basePublicationId = page.latest_publication_id;
    let baseVersionId = page.published_version_id;
    if (!baseVersionId && basePublicationId) {
      const latestPublication = await publicationsQueries.findById(
        db,
        workspaceId,
        basePublicationId
      );
      baseVersionId = latestPublication?.version_id ?? null;
    }

    const baseVersion = baseVersionId
      ? await pageVersionsQueries.findById(db, workspaceId, baseVersionId)
      : null;

    if (!baseVersion) {
      const result = await db
        .prepare(
          `UPDATE pages
           SET status = 'draft',
               trashed_at = NULL,
               updated_at = datetime('now')
           WHERE id = ? AND workspace_id = ? AND status = 'trash'`
        )
        .bind(id, workspaceId)
        .run();
      if (result.meta.changes === 0) return null;
      return this.findById(db, workspaceId, id);
    }

    const draftId = randomUUID();
    const nextVersionNumber = await this._nextVersionNumber(db, id);
    await db.batch([
      db
        .prepare(
          `INSERT INTO page_versions
             (id, workspace_id, page_id, version_number, status, source,
              base_version_id, base_publication_id, content)
           VALUES (?, ?, ?, ?, 'draft', 'restore', ?, ?, ?)`
        )
        .bind(
          draftId,
          workspaceId,
          id,
          nextVersionNumber,
          baseVersion.id,
          basePublicationId,
          baseVersion.content
        ),
      db
        .prepare(
          `UPDATE pages
           SET status = 'draft',
               current_draft_version_id = ?,
               trashed_at = NULL,
               updated_at = datetime('now')
           WHERE id = ? AND workspace_id = ? AND status = 'trash'`
        )
        .bind(draftId, id, workspaceId),
    ]);
    return this.findById(db, workspaceId, id);
  },

  /**
   * Permanent-delete a single trashed LP. Caller must have confirmed
   * with the user; this is irreversible. Only deletes from trash —
   * a non-trashed LP is left alone (returns false). Cascades through
   * page_meta / utm_links / page_versions / publications via the
   * foreign-key ON DELETE CASCADE on each child table.
   */
  async purge(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<boolean> {
    const result = await db
      .prepare(
        `DELETE FROM pages
         WHERE id = ? AND workspace_id = ? AND status = 'trash'`
      )
      .bind(id, workspaceId)
      .run();
    return result.meta.changes > 0;
  },

  /**
   * Soft-delete: move to trash and record `trashed_at` for the 7-day
   * cleanup cron. Physical deletion happens in a separate cron job.
   */
  async softDelete(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<Page | null> {
    const [, pageResult] = await db.batch([
      // End any active publication so publication history stays
      // aligned with the trash state and a stale active publication
      // row isn't left behind.
      db
        .prepare(
          `UPDATE publications
           SET status = 'ended', unpublished_at = datetime('now')
           WHERE page_id = ? AND workspace_id = ? AND status = 'active'`
        )
        .bind(id, workspaceId),
      db
        .prepare(
          `UPDATE pages
           SET status = 'trash',
               trashed_at = datetime('now'),
               updated_at = datetime('now')
           WHERE id = ? AND workspace_id = ?`
        )
        .bind(id, workspaceId),
    ]);

    if (pageResult.meta.changes === 0) return null;
    return this.findById(db, workspaceId, id);
  },

  /**
   * Next sequential version_number for a page. Used by publish /
   * republish to keep the UNIQUE(page_id, version_number) constraint
   * happy when a new snapshot row is appended.
   */
  async _nextVersionNumber(
    db: D1Database,
    pageId: string
  ): Promise<number> {
    const row = await db
      .prepare(
        `SELECT COALESCE(MAX(version_number), 0) AS max_version
         FROM page_versions WHERE page_id = ?`
      )
      .bind(pageId)
      .first<{ max_version: number }>();
    return (row?.max_version ?? 0) + 1;
  },
};

/**
 * Page version queries.
 *
 * Most callers should go through `pageQueries` (which owns the
 * three-layer state transitions). These helpers are the building
 * blocks used internally and exposed for routes that specifically
 * need to read or rewrite version rows in isolation.
 */
export const pageVersionsQueries = {
  async findById(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<PageVersion | null> {
    const result = await db
      .prepare(
        `SELECT * FROM page_versions
         WHERE id = ? AND workspace_id = ?
         LIMIT 1`
      )
      .bind(id, workspaceId)
      .first<PageVersion>();
    return result ?? null;
  },

  /**
   * Latest draft (`status='draft'`) for the page, if any. There's
   * usually exactly one draft per page — the row pages.current_draft_version_id
   * points at — but this helper is robust to historical state.
   */
  async findCurrentDraftForPage(
    db: D1Database,
    workspaceId: string,
    pageId: string
  ): Promise<PageVersion | null> {
    const result = await db
      .prepare(
        `SELECT pv.*
         FROM pages p
         JOIN page_versions pv ON pv.id = p.current_draft_version_id
         WHERE p.id = ? AND p.workspace_id = ?
         LIMIT 1`
      )
      .bind(pageId, workspaceId)
      .first<PageVersion>();
    return result ?? null;
  },

  /**
   * Currently-published snapshot for the page, if any.
   */
  async findPublishedForPage(
    db: D1Database,
    workspaceId: string,
    pageId: string
  ): Promise<PageVersion | null> {
    const result = await db
      .prepare(
        `SELECT pv.*
         FROM pages p
         JOIN page_versions pv ON pv.id = p.published_version_id
         WHERE p.id = ? AND p.workspace_id = ?
         LIMIT 1`
      )
      .bind(pageId, workspaceId)
      .first<PageVersion>();
    return result ?? null;
  },

  /**
   * Create a fresh draft row for a page. The caller is responsible
   * for wiring `pages.current_draft_version_id`; in most cases
   * `pageQueries.create` / `pageQueries.duplicate` already do that.
   */
  async createDraft(
    db: D1Database,
    workspaceId: string,
    params: {
      id: string;
      pageId: string;
      versionNumber: number;
      content: string;
      source?: PageVersion['source'];
      baseVersionId?: string | null;
      basePublicationId?: string | null;
      label?: string | null;
      createdBy?: string | null;
    }
  ): Promise<PageVersion> {
    await db
      .prepare(
        `INSERT INTO page_versions
           (id, workspace_id, page_id, version_number, status, source,
            base_version_id, base_publication_id, label, content, created_by)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        params.id,
        workspaceId,
        params.pageId,
        params.versionNumber,
        params.source ?? 'manual',
        params.baseVersionId ?? null,
        params.basePublicationId ?? null,
        params.label ?? null,
        params.content,
        params.createdBy ?? null
      )
      .run();
    const created = await this.findById(db, workspaceId, params.id);
    if (!created) throw new Error('Failed to create page_version');
    return created;
  },

  /**
   * Overwrite a draft's content in place. Useful when the caller
   * already knows the draft id; `pageQueries.updateContent` is the
   * higher-level entry point that resolves the draft via the page
   * pointer.
   */
  async updateDraftContent(
    db: D1Database,
    workspaceId: string,
    versionId: string,
    content: string
  ): Promise<PageVersion | null> {
    const result = await db
      .prepare(
        `UPDATE page_versions
         SET content = ?, updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ? AND status = 'draft'`
      )
      .bind(content, versionId, workspaceId)
      .run();
    if (result.meta.changes === 0) return null;
    return this.findById(db, workspaceId, versionId);
  },

  /**
   * Flip a draft into a permanent published snapshot. Used by future
   * runtime code that wants to freeze a draft directly rather than
   * appending a fresh snapshot row.
   */
  async markPublishedSnapshot(
    db: D1Database,
    workspaceId: string,
    versionId: string
  ): Promise<PageVersion | null> {
    const result = await db
      .prepare(
        `UPDATE page_versions
         SET status = 'published_snapshot', updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(versionId, workspaceId)
      .run();
    if (result.meta.changes === 0) return null;
    return this.findById(db, workspaceId, versionId);
  },

  /**
   * Archive every draft on the page (e.g. after a destructive
   * publish-from-fresh-snapshot flow). Leaves published_snapshot and
   * archived rows alone.
   */
  async archiveDraftsForPage(
    db: D1Database,
    workspaceId: string,
    pageId: string
  ): Promise<void> {
    await db
      .prepare(
        `UPDATE page_versions
         SET status = 'archived', updated_at = datetime('now')
         WHERE page_id = ? AND workspace_id = ? AND status = 'draft'`
      )
      .bind(pageId, workspaceId)
      .run();
  },

  /**
   * Next sequential version_number for a page. Mirrors the helper on
   * pageQueries; exposed here for callers that work directly with the
   * version table.
   */
  async nextVersionNumber(
    db: D1Database,
    _workspaceId: string,
    pageId: string
  ): Promise<number> {
    return pageQueries._nextVersionNumber(db, pageId);
  },
};

/**
 * Publication queries.
 */
export const publicationsQueries = {
  async findById(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<Publication | null> {
    const result = await db
      .prepare(
        `SELECT * FROM publications
         WHERE id = ? AND workspace_id = ?
         LIMIT 1`
      )
      .bind(id, workspaceId)
      .first<Publication>();
    return result ?? null;
  },

  async findActiveByPageId(
    db: D1Database,
    workspaceId: string,
    pageId: string
  ): Promise<Publication | null> {
    const result = await db
      .prepare(
        `SELECT * FROM publications
         WHERE page_id = ? AND workspace_id = ? AND status = 'active'
         LIMIT 1`
      )
      .bind(pageId, workspaceId)
      .first<Publication>();
    return result ?? null;
  },

  async listByPageId(
    db: D1Database,
    workspaceId: string,
    pageId: string
  ): Promise<Publication[]> {
    const result = await db
      .prepare(
        `SELECT * FROM publications
         WHERE page_id = ? AND workspace_id = ?
         ORDER BY published_at DESC`
      )
      .bind(pageId, workspaceId)
      .all<Publication>();
    return result.results ?? [];
  },

  async ensureRenderSettingsSnapshot(
    db: D1Database,
    workspaceId: string,
    page: Page
  ): Promise<void> {
    const active = await this.findActiveByPageId(db, workspaceId, page.id);
    if (!active || readPublicationRenderSettings(active.meta)) return;
    await db
      .prepare(
        `UPDATE publications
         SET meta = ?
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(
        publicationMetaWithRenderSettings(active.meta, page),
        active.id,
        workspaceId
      )
      .run();
  },

  /**
   * End every currently-active publication for the page. Idempotent.
   * Most callers should go through `pageQueries.unpublish` /
   * `pageQueries.republish`, which also clean up the pages pointers.
   */
  async endActiveForPage(
    db: D1Database,
    workspaceId: string,
    pageId: string
  ): Promise<void> {
    await db
      .prepare(
        `UPDATE publications
         SET status = 'ended', unpublished_at = datetime('now')
         WHERE page_id = ? AND workspace_id = ? AND status = 'active'`
      )
      .bind(pageId, workspaceId)
      .run();
  },

  /**
   * Insert a fresh active publication row. Caller must guarantee no
   * other active row exists for the page (the partial unique index
   * `idx_publications_one_active_per_page` enforces this at the DB
   * layer too).
   */
  async createActive(
    db: D1Database,
    workspaceId: string,
    params: {
      id: string;
      pageId: string;
      versionId: string;
      source?: Publication['source'];
      createdBy?: string | null;
      label?: string | null;
      meta?: string | null;
    }
  ): Promise<Publication> {
    await db
      .prepare(
        `INSERT INTO publications
           (id, workspace_id, page_id, version_id, status, source,
            created_by, label, meta)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`
      )
      .bind(
        params.id,
        workspaceId,
        params.pageId,
        params.versionId,
        params.source ?? 'manual',
        params.createdBy ?? null,
        params.label ?? null,
        params.meta ?? null
      )
      .run();
    const created = await this.findById(db, workspaceId, params.id);
    if (!created) throw new Error('Failed to create publication');
    return created;
  },
};

/**
 * Build a `PageWithDraft` from a row returned by `findByIdWithDraft`
 * (or `findByPreviewToken`, or `listAll`).
 */
function hydrateWithDraft(
  row: Page & {
    draft_version_id_resolved: string | null;
    draft_content: string | null;
    published_content: string | null;
    active_publication_meta?: string | null;
  }
): PageWithDraft {
  const {
    draft_version_id_resolved,
    draft_content,
    published_content,
    active_publication_meta,
    ...page
  } = row;
  return {
    ...(page as Page),
    draft_version_id: draft_version_id_resolved,
    active_publication_meta: active_publication_meta ?? null,
    content: draft_content ?? published_content ?? '{}',
    live_content: published_content,
  };
}

/**
 * Site-wide settings (singleton row, id=1).
 */
export interface SiteSettings {
  id: number;
  maintenance_mode: number;
  custom_domain: string | null;
  meta: string | null;
  updated_at: string;
}

export const siteSettingsQueries = {
  /**
   * Get the singleton settings row, seeding it on first read so
   * downstream code never sees null.
   */
  async get(db: D1Database): Promise<SiteSettings> {
    const existing = await db
      .prepare('SELECT * FROM site_settings WHERE id = 1 LIMIT 1')
      .first<SiteSettings>();
    if (existing) return existing;
    await db
      .prepare(`INSERT INTO site_settings (id) VALUES (1)`)
      .run();
    const created = await db
      .prepare('SELECT * FROM site_settings WHERE id = 1 LIMIT 1')
      .first<SiteSettings>();
    if (!created) throw new Error('Failed to seed site_settings');
    return created;
  },

  async setMaintenanceMode(
    db: D1Database,
    enabled: boolean
  ): Promise<SiteSettings> {
    await this.get(db);
    await db
      .prepare(
        `UPDATE site_settings SET maintenance_mode = ?, updated_at = datetime('now') WHERE id = 1`
      )
      .bind(enabled ? 1 : 0)
      .run();
    return this.get(db);
  },
};

/**
 * Whether a page is currently visible to the public, accounting for
 * its status and the publish_at / unpublish_at scheduling window.
 *
 * `status='published'` is required, then:
 *   - publish_at null  → start of time
 *   - publish_at set   → must be in the past
 *   - unpublish_at null → end of time
 *   - unpublish_at set → must be in the future
 */
export function isLiveNow(
  page: Pick<Page, 'status' | 'publish_at' | 'unpublish_at'>,
  now: Date = new Date()
): boolean {
  if (page.status !== 'published') return false;
  const t = now.getTime();
  if (page.publish_at) {
    const start = new Date(page.publish_at).getTime();
    if (Number.isFinite(start) && t < start) return false;
  }
  if (page.unpublish_at) {
    const end = new Date(page.unpublish_at).getTime();
    if (Number.isFinite(end) && t >= end) return false;
  }
  return true;
}

export function isPublicationEnded(
  page: Pick<Page, 'status' | 'latest_publication_id' | 'unpublish_at'>,
  now: Date = new Date()
): boolean {
  if (page.status === 'archived' && page.latest_publication_id) return true;
  if (page.status !== 'published') return false;
  if (!page.unpublish_at) return false;
  const end = new Date(page.unpublish_at).getTime();
  return Number.isFinite(end) && now.getTime() >= end;
}

/**
 * MyLink record from D1.
 *
 * MyLinks are self-hoster-managed shortcuts for destinations like LINE
 * URLs, contact email addresses, phone numbers etc. CTAs
 * can reference a MyLink by id, so changing the MyLink updates every
 * CTA on every LP that points at it.
 */
export interface MyLink {
  id: string;
  workspace_id: string;
  label: string;
  url: string;
  meta: string | null;
  created_at: string;
  updated_at: string;
}

export const myLinkQueries = {
  async list(db: D1Database, workspaceId: string): Promise<MyLink[]> {
    const result = await db
      .prepare(
        'SELECT * FROM my_links WHERE workspace_id = ? ORDER BY updated_at DESC'
      )
      .bind(workspaceId)
      .all<MyLink>();
    return result.results ?? [];
  },

  async findById(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<MyLink | null> {
    const result = await db
      .prepare(
        'SELECT * FROM my_links WHERE id = ? AND workspace_id = ? LIMIT 1'
      )
      .bind(id, workspaceId)
      .first<MyLink>();
    return result ?? null;
  },

  async create(
    db: D1Database,
    workspaceId: string,
    params: { id: string; label: string; url: string }
  ): Promise<MyLink> {
    await db
      .prepare(
        `INSERT INTO my_links (id, workspace_id, label, url) VALUES (?, ?, ?, ?)`
      )
      .bind(params.id, workspaceId, params.label, params.url)
      .run();

    const created = await this.findById(db, workspaceId, params.id);
    if (!created) throw new Error('Failed to create MyLink');
    return created;
  },

  async update(
    db: D1Database,
    workspaceId: string,
    id: string,
    params: { label: string; url: string }
  ): Promise<MyLink | null> {
    const result = await db
      .prepare(
        `UPDATE my_links
         SET label = ?, url = ?, updated_at = datetime('now')
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(params.label, params.url, id, workspaceId)
      .run();
    if (result.meta.changes === 0) return null;
    return this.findById(db, workspaceId, id);
  },

  async remove(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<boolean> {
    const result = await db
      .prepare('DELETE FROM my_links WHERE id = ? AND workspace_id = ?')
      .bind(id, workspaceId)
      .run();
    return result.meta.changes > 0;
  },
};

/**
 * Site-wide tracking tag IDs, scoped per workspace (one row per
 * workspace_id; primary key).
 *
 * `meta` JSON holds extras like custom head HTML — keeps the row
 * forward-compatible without further migrations.
 */
export interface TrackingTags {
  workspace_id: string;
  gtm_id: string | null;
  ga4_id: string | null;
  clarity_id: string | null;
  meta_pixel_id: string | null;
  line_tag_id: string | null;
  tiktok_pixel_id: string | null;
  x_pixel_id: string | null;
  hotjar_id: string | null;
  meta: string | null;
  updated_at: string;
}

export const trackingTagsQueries = {
  /**
   * Returns the workspace's row, or null if it hasn't been created yet.
   */
  async get(
    db: D1Database,
    workspaceId: string
  ): Promise<TrackingTags | null> {
    const result = await db
      .prepare('SELECT * FROM tracking_tags WHERE workspace_id = ? LIMIT 1')
      .bind(workspaceId)
      .first<TrackingTags>();
    return result ?? null;
  },

  /**
   * Insert-or-update the workspace's row. Only fields present in
   * `params` are touched; the rest keep their existing values.
   */
  async upsert(
    db: D1Database,
    workspaceId: string,
    params: Partial<Omit<TrackingTags, 'workspace_id' | 'updated_at'>>
  ): Promise<TrackingTags> {
    const existing = await this.get(db, workspaceId);

    if (!existing) {
      const cols = ['workspace_id'] as string[];
      const placeholders = ['?'] as string[];
      const binds: (string | null)[] = [workspaceId];
      for (const [key, value] of Object.entries(params)) {
        cols.push(key);
        placeholders.push('?');
        binds.push((value as string | null | undefined) ?? null);
      }
      await db
        .prepare(
          `INSERT INTO tracking_tags (${cols.join(',')}) VALUES (${placeholders.join(',')})`
        )
        .bind(...binds)
        .run();
    } else {
      const fields: string[] = [];
      const binds: (string | null)[] = [];
      for (const [key, value] of Object.entries(params)) {
        fields.push(`${key} = ?`);
        binds.push((value as string | null | undefined) ?? null);
      }
      if (fields.length > 0) {
        fields.push("updated_at = datetime('now')");
        binds.push(workspaceId);
        await db
          .prepare(
            `UPDATE tracking_tags SET ${fields.join(', ')} WHERE workspace_id = ?`
          )
          .bind(...binds)
          .run();
      }
    }

    const after = await this.get(db, workspaceId);
    if (!after) throw new Error('Failed to upsert tracking_tags');
    return after;
  },
};

/**
 * UtmLink record from D1.
 *
 * Each row is a campaign-tagged short link belonging to a page.
 * Visiting /go/:shortPath bounces the visitor to the page's public
 * URL with the UTM params attached, so the self-hoster can hand out
 * one short URL per channel (X, Instagram, mail, etc.) and read
 * the breakdown in GA4 / GTM.
 */
export interface UtmLink {
  id: string;
  workspace_id: string;
  page_id: string | null;
  label: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  short_path: string | null;
  meta: string | null;
  created_at: string;
  updated_at: string;
}

export const utmLinkQueries = {
  async listByPage(
    db: D1Database,
    workspaceId: string,
    pageId: string
  ): Promise<UtmLink[]> {
    const result = await db
      .prepare(
        `SELECT * FROM utm_links
         WHERE page_id = ? AND workspace_id = ?
         ORDER BY created_at DESC`
      )
      .bind(pageId, workspaceId)
      .all<UtmLink>();
    return result.results ?? [];
  },

  async findByShortPath(
    db: D1Database,
    shortPath: string
  ): Promise<UtmLink | null> {
    const result = await db
      .prepare('SELECT * FROM utm_links WHERE short_path = ? LIMIT 1')
      .bind(shortPath)
      .first<UtmLink>();
    return result ?? null;
  },

  async existsByShortPath(
    db: D1Database,
    shortPath: string
  ): Promise<boolean> {
    const result = await db
      .prepare('SELECT 1 FROM utm_links WHERE short_path = ? LIMIT 1')
      .bind(shortPath)
      .first<{ '1': number }>();
    return result !== null;
  },

  async create(
    db: D1Database,
    workspaceId: string,
    params: {
      id: string;
      pageId: string;
      label: string;
      utmSource: string | null;
      utmMedium: string | null;
      utmCampaign: string | null;
      utmContent: string | null;
      utmTerm: string | null;
      shortPath: string;
    }
  ): Promise<UtmLink> {
    await db
      .prepare(
        `INSERT INTO utm_links
         (id, workspace_id, page_id, label, utm_source, utm_medium, utm_campaign,
          utm_content, utm_term, short_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        params.id,
        workspaceId,
        params.pageId,
        params.label,
        params.utmSource,
        params.utmMedium,
        params.utmCampaign,
        params.utmContent,
        params.utmTerm,
        params.shortPath
      )
      .run();

    const created = await db
      .prepare('SELECT * FROM utm_links WHERE id = ?')
      .bind(params.id)
      .first<UtmLink>();
    if (!created) throw new Error('Failed to create UTM link');
    return created;
  },

  async update(
    db: D1Database,
    workspaceId: string,
    pageId: string,
    id: string,
    params: {
      label: string;
      utmSource: string | null;
      utmMedium: string | null;
      utmCampaign: string | null;
      utmContent: string | null;
      utmTerm: string | null;
    }
  ): Promise<UtmLink | null> {
    const result = await db
      .prepare(
        `UPDATE utm_links
         SET label = ?,
             utm_source = ?,
             utm_medium = ?,
             utm_campaign = ?,
             utm_content = ?,
             utm_term = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND workspace_id = ? AND page_id = ?`
      )
      .bind(
        params.label,
        params.utmSource,
        params.utmMedium,
        params.utmCampaign,
        params.utmContent,
        params.utmTerm,
        id,
        workspaceId,
        pageId
      )
      .run();
    if (result.meta.changes === 0) return null;

    const updated = await db
      .prepare(
        'SELECT * FROM utm_links WHERE id = ? AND workspace_id = ? AND page_id = ?'
      )
      .bind(id, workspaceId, pageId)
      .first<UtmLink>();
    return updated ?? null;
  },

  async remove(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<boolean> {
    const result = await db
      .prepare('DELETE FROM utm_links WHERE id = ? AND workspace_id = ?')
      .bind(id, workspaceId)
      .run();
    return result.meta.changes > 0;
  },
};

/**
 * Hub Connector lifecycle status.
 *   - pending  : row exists but the connector hasn't handshake-verified yet
 *   - active   : connector is reachable; emitting the <script> tag is allowed
 *   - error    : last verify attempt failed
 *   - disabled : explicitly disabled by the operator
 *
 * Only `active` permits the public renderer to emit the script tag —
 * any other value short-circuits the safety check in
 * `resolveHubConnectorScript`.
 */
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
 * Read the per-LP override at `pages.meta.hub_connector.enabled`.
 * Missing meta / missing key → defaults to `true` (no opt-out).
 * Broken meta JSON falls back to the default so a parse failure
 * never blocks the connector script from rendering on other LPs.
 */
export function readLpHubConnectorEnabled(
  metaRaw: string | null | undefined
): boolean {
  if (!metaRaw) return true;
  try {
    const parsed: unknown = JSON.parse(metaRaw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const hub = (parsed as Record<string, unknown>).hub_connector;
      if (hub && typeof hub === 'object' && !Array.isArray(hub)) {
        const enabled = (hub as Record<string, unknown>).enabled;
        if (typeof enabled === 'boolean') return enabled;
      }
    }
  } catch {
    // fall through to default true
  }
  return true;
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
 *   - the LP-level override (`pages.meta.hub_connector.enabled`) is
 *     not false
 *   - lp / version / publication ids are all present
 *   - publicUrl is known
 */
export function resolveHubConnectorScript(params: {
  resolved: ResolvedHubConnector | null;
  lpId: string | null | undefined;
  versionId: string | null | undefined;
  publicationId: string | null | undefined;
  publicUrl: string | null | undefined;
  lpHubConnectorEnabled: boolean;
}): HubConnectorScriptDescriptor | null {
  const {
    resolved,
    lpId,
    versionId,
    publicationId,
    publicUrl,
    lpHubConnectorEnabled,
  } = params;
  if (!resolved) return null;
  if (!resolved.enabled) return null;
  if (resolved.status !== 'active') return null;
  if (!resolved.scriptEnabled) return null;
  if (!resolved.scriptUrl || !isHttpsUrl(resolved.scriptUrl)) return null;
  if (!resolved.connectionId) return null;
  if (!lpId || !versionId || !publicationId) return null;
  if (!publicUrl) return null;
  if (!lpHubConnectorEnabled) return null;
  return {
    scriptUrl: resolved.scriptUrl,
    connectionId: resolved.connectionId,
    lpId,
    versionId,
    publicationId,
    publicUrl,
  };
}

/**
 * Site-wide metadata defaults, scoped per workspace (one row per
 * workspace_id; primary key).
 * Used for favicon / Apple-touch-icon and as OGP fallback when
 * an individual LP doesn't supply its own.
 */
export interface SiteMeta {
  workspace_id: string;
  site_title: string | null;
  site_description: string | null;
  favicon_url: string | null;
  ogp_default_image_url: string | null;
  ogp_default_title: string | null;
  ogp_default_description: string | null;
  // Public host the self-hoster entered on the site-settings page,
  // e.g. "lp.example.com" or "campaign.example.com". NULL means
  // the self-hoster hasn't wired a custom domain yet —
  // everything (canonical, QR, share URL) falls back to workers.dev.
  domain: string | null;
  // When 1, every workers.dev request 301s to https://{domain}/{path}.
  // INTEGER (0/1) because SQLite has no boolean — callers should
  // treat 0 as "workers.dev still works" and 1 as "workers.dev is the
  // legacy URL, please redirect".
  workers_dev_disabled: number;
  meta: string | null;
  updated_at: string;
}

export const siteMetaQueries = {
  async get(
    db: D1Database,
    workspaceId: string
  ): Promise<SiteMeta | null> {
    const result = await db
      .prepare('SELECT * FROM site_meta WHERE workspace_id = ? LIMIT 1')
      .bind(workspaceId)
      .first<SiteMeta>();
    return result ?? null;
  },

  async upsert(
    db: D1Database,
    workspaceId: string,
    params: Partial<Omit<SiteMeta, 'workspace_id' | 'updated_at'>>
  ): Promise<SiteMeta> {
    const existing = await this.get(db, workspaceId);

    if (!existing) {
      const cols = ['workspace_id'] as string[];
      const placeholders = ['?'] as string[];
      const binds: (string | number | null)[] = [workspaceId];
      for (const [key, value] of Object.entries(params)) {
        cols.push(key);
        placeholders.push('?');
        binds.push((value as string | number | null | undefined) ?? null);
      }
      await db
        .prepare(
          `INSERT INTO site_meta (${cols.join(',')}) VALUES (${placeholders.join(',')})`
        )
        .bind(...binds)
        .run();
    } else {
      const fields: string[] = [];
      const binds: (string | number | null)[] = [];
      for (const [key, value] of Object.entries(params)) {
        fields.push(`${key} = ?`);
        binds.push((value as string | number | null | undefined) ?? null);
      }
      if (fields.length > 0) {
        fields.push("updated_at = datetime('now')");
        binds.push(workspaceId);
        await db
          .prepare(
            `UPDATE site_meta SET ${fields.join(', ')} WHERE workspace_id = ?`
          )
          .bind(...binds)
          .run();
      }
    }

    const after = await this.get(db, workspaceId);
    if (!after) throw new Error('Failed to upsert site_meta');
    return after;
  },
};

/**
 * Generate a short, URL-friendly token for /go/:shortPath.
 * Uses base36 chars from crypto.randomUUID for collision safety
 * without going full UUID length.
 */
export function generateShortPath(length = 6): string {
  const uuid = randomUUID().replace(/-/g, '');
  // Base16 chars are URL-safe — keep first N hex chars
  return uuid.slice(0, length);
}

/**
 * Generate a unique ID (used for users, pages, etc.)
 * Uses randomUUID() which is available in Cloudflare Workers.
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Admin authentication tables.
 *
 * `admin_users` is the source of truth for "who is allowed into
 * /admin"; `admin_sessions` holds the live browser sessions issued
 * after a Google OAuth round-trip.
 *
 * The legacy `users` table is left in place but is no longer read or
 * written by the auth path.
 */

export interface AdminUser {
  id: string;
  workspace_id: string;
  email: string;
  google_sub: string | null;
  role: string;
  created_at: string;
  last_login_at: string | null;
}

export const adminUserQueries = {
  async findByEmail(
    db: D1Database,
    workspaceId: string,
    email: string
  ): Promise<AdminUser | null> {
    const result = await db
      .prepare(
        `SELECT * FROM admin_users WHERE workspace_id = ? AND email = ?`
      )
      .bind(workspaceId, email)
      .first<AdminUser>();
    return result ?? null;
  },

  async findById(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<AdminUser | null> {
    const result = await db
      .prepare(
        `SELECT * FROM admin_users WHERE workspace_id = ? AND id = ?`
      )
      .bind(workspaceId, id)
      .first<AdminUser>();
    return result ?? null;
  },

  async list(
    db: D1Database,
    workspaceId: string
  ): Promise<AdminUser[]> {
    const result = await db
      .prepare(
        `SELECT * FROM admin_users WHERE workspace_id = ? ORDER BY created_at ASC`
      )
      .bind(workspaceId)
      .all<AdminUser>();
    return result.results ?? [];
  },

  async count(db: D1Database, workspaceId: string): Promise<number> {
    const result = await db
      .prepare(
        `SELECT COUNT(*) as count FROM admin_users WHERE workspace_id = ?`
      )
      .bind(workspaceId)
      .first<{ count: number }>();
    return result?.count ?? 0;
  },

  async create(
    db: D1Database,
    params: {
      id: string;
      workspaceId: string;
      email: string;
      googleSub: string | null;
      role?: string;
    }
  ): Promise<AdminUser> {
    await db
      .prepare(
        `INSERT INTO admin_users (id, workspace_id, email, google_sub, role)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        params.id,
        params.workspaceId,
        params.email,
        params.googleSub,
        params.role ?? 'owner'
      )
      .run();
    const created = await this.findById(db, params.workspaceId, params.id);
    if (!created) throw new Error('Failed to create admin_user');
    return created;
  },

  async updateGoogleSub(
    db: D1Database,
    workspaceId: string,
    id: string,
    googleSub: string
  ): Promise<void> {
    await db
      .prepare(
        `UPDATE admin_users SET google_sub = ? WHERE workspace_id = ? AND id = ?`
      )
      .bind(googleSub, workspaceId, id)
      .run();
  },

  async updateLastLogin(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<void> {
    await db
      .prepare(
        `UPDATE admin_users SET last_login_at = datetime('now')
         WHERE workspace_id = ? AND id = ?`
      )
      .bind(workspaceId, id)
      .run();
  },

  async deleteById(
    db: D1Database,
    workspaceId: string,
    id: string
  ): Promise<void> {
    await db
      .prepare(
        `DELETE FROM admin_users WHERE workspace_id = ? AND id = ?`
      )
      .bind(workspaceId, id)
      .run();
  },
};

export interface AdminSession {
  token: string;
  admin_user_id: string;
  workspace_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

export const adminSessionQueries = {
  async create(
    db: D1Database,
    params: {
      token: string;
      adminUserId: string;
      workspaceId: string;
      expiresAtIso: string;
    }
  ): Promise<void> {
    await db
      .prepare(
        `INSERT INTO admin_sessions (token, admin_user_id, workspace_id, expires_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(
        params.token,
        params.adminUserId,
        params.workspaceId,
        params.expiresAtIso
      )
      .run();
  },

  /**
   * Look up a session by token AND verify it hasn't expired. Returns
   * the joined admin_user when valid, null otherwise. Side effect: on
   * a hit, both `last_seen_at` and `expires_at` are pushed forward
   * (sliding 30-day expiration). The bump is best-effort — a write
   * failure shouldn't lock the operator out, so it's not awaited
   * inside the same prepare().
   */
  async findValidWithUser(
    db: D1Database,
    token: string
  ): Promise<{ session: AdminSession; user: AdminUser } | null> {
    const row = await db
      .prepare(
        `SELECT
           s.token AS s_token,
           s.admin_user_id AS s_admin_user_id,
           s.workspace_id AS s_workspace_id,
           s.created_at AS s_created_at,
           s.expires_at AS s_expires_at,
           s.last_seen_at AS s_last_seen_at,
           u.id AS u_id,
           u.workspace_id AS u_workspace_id,
           u.email AS u_email,
           u.google_sub AS u_google_sub,
           u.role AS u_role,
           u.created_at AS u_created_at,
           u.last_login_at AS u_last_login_at
         FROM admin_sessions s
         JOIN admin_users u ON u.id = s.admin_user_id
         WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
         LIMIT 1`
      )
      .bind(token)
      .first<Record<string, string | null>>();
    if (!row) return null;
    return {
      session: {
        token: row.s_token as string,
        admin_user_id: row.s_admin_user_id as string,
        workspace_id: row.s_workspace_id as string,
        created_at: row.s_created_at as string,
        expires_at: row.s_expires_at as string,
        last_seen_at: row.s_last_seen_at as string,
      },
      user: {
        id: row.u_id as string,
        workspace_id: row.u_workspace_id as string,
        email: row.u_email as string,
        google_sub: row.u_google_sub,
        role: row.u_role as string,
        created_at: row.u_created_at as string,
        last_login_at: row.u_last_login_at,
      },
    };
  },

  async slide(
    db: D1Database,
    token: string,
    expiresAtIso: string
  ): Promise<void> {
    await db
      .prepare(
        `UPDATE admin_sessions
         SET last_seen_at = datetime('now'), expires_at = ?
         WHERE token = ?`
      )
      .bind(expiresAtIso, token)
      .run();
  },

  async deleteByToken(db: D1Database, token: string): Promise<void> {
    await db
      .prepare(`DELETE FROM admin_sessions WHERE token = ?`)
      .bind(token)
      .run();
  },

  async deleteByAdminUserId(
    db: D1Database,
    workspaceId: string,
    adminUserId: string
  ): Promise<void> {
    await db
      .prepare(
        `DELETE FROM admin_sessions WHERE workspace_id = ? AND admin_user_id = ?`
      )
      .bind(workspaceId, adminUserId)
      .run();
  },
};

async function nextDuplicateTitle(
  db: D1Database,
  workspaceId: string,
  baseTitle: string
): Promise<string> {
  const first = `${baseTitle} のコピー`;
  const rows = await db
    .prepare(
      `SELECT title FROM pages
       WHERE workspace_id = ?
         AND title IS NOT NULL
         AND (title = ? OR title LIKE ?)`
    )
    .bind(workspaceId, first, `${first}%`)
    .all<{ title: string }>();
  const used = new Set(
    (rows.results ?? [])
      .map((row) => row.title)
      .filter((title): title is string => typeof title === 'string')
  );

  if (!used.has(first)) return first;
  for (let i = 2; i < 10000; i += 1) {
    const candidate = `${first}${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${first}${Date.now()}`;
}
