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
