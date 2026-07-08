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
   * Next sequential version_number for a page. Used by publish /
   * republish (via pageQueries) to keep the UNIQUE(page_id,
   * version_number) constraint happy when a new snapshot row is
   * appended. Lives here (not on pageQueries) because it only touches
   * page_versions — pageQueries calls this rather than the reverse to
   * avoid a pages <-> page-versions import cycle.
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

  /**
   * Next sequential version_number for a page. Exposed here for
   * callers that work directly with the version table.
   */
  async nextVersionNumber(
    db: D1Database,
    _workspaceId: string,
    pageId: string
  ): Promise<number> {
    return this._nextVersionNumber(db, pageId);
  },
};
