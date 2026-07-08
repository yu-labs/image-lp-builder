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
