/**
 * User-related queries
 */
export const userQueries = {
  /**
   * Find user by email. Returns null if not found.
   */
  async findByEmail(db: D1Database, email: string): Promise<User | null> {
    const result = await db
      .prepare('SELECT * FROM users WHERE email = ?')
      .bind(email)
      .first<User>();
    return result ?? null;
  },

  /**
   * Create a new user. Returns the created user.
   */
  async create(
    db: D1Database,
    params: { id: string; email: string; role: 'owner' | 'editor' }
  ): Promise<User> {
    await db
      .prepare(
        `INSERT INTO users (id, email, role) VALUES (?, ?, ?)`
      )
      .bind(params.id, params.email, params.role)
      .run();

    const created = await this.findByEmail(db, params.email);
    if (!created) {
      throw new Error('Failed to create user');
    }
    return created;
  },

  /**
   * Update user's last_login_at timestamp.
   */
  async updateLastLogin(db: D1Database, userId: string): Promise<void> {
    await db
      .prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`)
      .bind(userId)
      .run();
  },

  /**
   * Count total users (used to detect first-time setup).
   */
  async count(db: D1Database): Promise<number> {
    const result = await db
      .prepare('SELECT COUNT(*) as count FROM users')
      .first<{ count: number }>();
    return result?.count ?? 0;
  },
};
