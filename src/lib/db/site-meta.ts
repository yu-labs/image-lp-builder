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
