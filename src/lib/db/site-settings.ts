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
