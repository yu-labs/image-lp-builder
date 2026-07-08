import {
  publicationMetaWithRenderSettings,
  readPublicationRenderSettings,
} from './page-render-settings';

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
    page: {
      id: string;
      max_width: number;
      background_color: string | null;
      frame_style: 'line' | 'shadow' | 'none' | null;
    }
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
