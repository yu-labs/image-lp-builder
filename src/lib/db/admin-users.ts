/**
 * Admin authentication tables.
 *
 * `admin_users` is the source of truth for "who is allowed into
 * /admin"; `admin_sessions` (admin-sessions.ts) holds the live browser
 * sessions issued after a Google OAuth round-trip.
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
