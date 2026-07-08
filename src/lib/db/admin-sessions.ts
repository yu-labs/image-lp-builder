import type { AdminUser } from './admin-users';

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
