import { randomUUID } from '../uuid';
import type { PageContent } from '../content';
import {
  applyPublishedRenderSettings,
  publicationMetaWithRenderSettings,
  readPublicationRenderSettings,
  sameRenderSettings,
  pageRenderSettings,
} from './page-render-settings';
import { pageVersionsQueries, type PageVersion } from './page-versions';
import { publicationsQueries } from './publications';

const NEW_LP_CONTENT = '{"version":1,"sections":[],"meta":{"noindex":true}}';
const NEW_LP_PAGE_META = '{}';

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
      const nextVersionNumber = await pageVersionsQueries._nextVersionNumber(
        db,
        id
      );
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
    const versionNumber = await pageVersionsQueries._nextVersionNumber(
      db,
      pageId
    );
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
    const nextVersionNumber = await pageVersionsQueries._nextVersionNumber(
      db,
      id
    );
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
};
