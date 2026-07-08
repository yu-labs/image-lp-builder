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
