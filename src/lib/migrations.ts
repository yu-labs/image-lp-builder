/**
 * Migration runner for D1.
 *
 * Self-hosters deploy this OSS by clicking a "Deploy to Cloudflare"
 * button — they never touch wrangler or open a SQL prompt. So
 * applying schema migrations has to happen *automatically* on the
 * first request after a fresh deploy or upgrade.
 *
 * Strategy:
 * - Each `migrations/*.sql` file is imported at build time as a raw
 *   string via Vite's `?raw` query (zero runtime fetch cost).
 * - Each file is split into UP and DOWN sections by the `-- DOWN:`
 *   marker line. UP runs forward, DOWN reverses the change. db.batch
 *   gives each direction file-level atomicity (D1's transaction
 *   primitive — explicit BEGIN/COMMIT in user SQL is rejected).
 * - On the first request handled by an isolate, runPendingMigrations
 *   bootstraps `schema_migrations` if necessary, reads the set of
 *   versions already applied, and runs every newer SQL file in order.
 *   It tracks which versions were applied during this run; on failure
 *   it walks the list in reverse and runs each DOWN to restore the
 *   pre-update schema. The batch is the bank-transaction unit.
 * - A module-scoped Promise caches the result so a single isolate
 *   doesn't re-check on every request.
 */

import migration0001 from '../../migrations/0001_initial_schema.sql?raw';
import migration0002 from '../../migrations/0002_hub_connector_snapshot_push.sql?raw';
import migration0003 from '../../migrations/0003_site_domain_public_host.sql?raw';

interface Migration {
  version: string;
  sql: string;
}

interface MigrationRunOptions {
  /**
   * Local development can carry a stale pre-publication D1 database
   * under .wrangler/state. That database may already contain
   * schema_migrations rows for the old migration chain while missing
   * the current clean-baseline tables. In that one local-only case,
   * reset the local schema so /admin works after pulling the current
   * OSS-ready code.
   */
  repairLegacyLocalBaseline?: boolean;
}

// Order matters — versions are applied in array order. 0001 is the
// clean baseline that contains every table this OSS needs; later
// migrations append columns / tables to it.
const MIGRATIONS: ReadonlyArray<Migration> = [
  { version: '0001_initial_schema', sql: migration0001 },
  { version: '0002_hub_connector_snapshot_push', sql: migration0002 },
  { version: '0003_site_domain_public_host', sql: migration0003 },
];

const REQUIRED_BASELINE_TABLES = [
  'pages',
  'page_versions',
  'publications',
  'connections',
  'admin_users',
  'admin_sessions',
  'workspace_github_installations',
  'schema_migrations',
] as const;

const LEGACY_LOCAL_TABLE_DROPS = [
  'DROP TABLE IF EXISTS clicks',
  'DROP TABLE IF EXISTS page_views',
  'DROP TABLE IF EXISTS sessions',
  'DROP TABLE IF EXISTS mcp_tokens',
  'DROP TABLE IF EXISTS mcp_settings',
];

/**
 * Marker that splits each migration file into a forward (UP) and a
 * reverse (DOWN) section. The marker line itself is dropped during
 * parsing; everything before it is the UP path, everything after is
 * the DOWN path. A file without the marker has no DOWN section and
 * cannot be auto-rolled-back.
 */
const DOWN_MARKER = '-- DOWN:';

let runOnce: Promise<void> | null = null;

/**
 * Apply any migrations the database is missing. Safe to call on
 * every request — the actual work is memoised per isolate.
 *
 * On failure, all migrations applied during this call are rolled
 * back via their DOWN sections (in reverse order) so the database
 * ends up byte-identical to its pre-call state. Migrations that were
 * already applied before this call are left untouched.
 */
export function runPendingMigrations(
  db: D1Database,
  options: MigrationRunOptions = {}
): Promise<void> {
  if (runOnce) return runOnce;
  runOnce = applyMigrations(db, options).catch((err) => {
    // Reset the cache so a future request can retry; logging is
    // best-effort because we don't want a migration failure to
    // crash the whole isolate.
    runOnce = null;
    console.error('Migration failed:', err);
    throw err;
  });
  return runOnce;
}

async function applyMigrations(
  db: D1Database,
  options: MigrationRunOptions
): Promise<void> {
  // Read which versions are already applied. On a fresh database
  // schema_migrations doesn't exist yet — treat the SELECT failure
  // as "no migrations applied". Each migration file is responsible
  // for creating any tables it needs (including schema_migrations
  // itself in 0001).
  let appliedVersions = new Set<string>();
  try {
    const applied = await db
      .prepare('SELECT version FROM schema_migrations')
      .all<{ version: string }>();
    appliedVersions = new Set((applied.results ?? []).map((r) => r.version));
  } catch {
    // schema_migrations doesn't exist — fall through, run everything.
  }

  // Track which versions THIS call applies. On failure we use this
  // list (in reverse) to undo the partial change. Migrations applied
  // before this call were committed long ago and stay put.
  const appliedThisRun: Migration[] = [];

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    const { up } = splitMigration(migration.sql);
    const upStatements = splitStatements(up);
    if (upStatements.length === 0) {
      throw new Error(
        `Migration ${migration.version} has no UP statements`
      );
    }
    try {
      // db.batch is D1's transaction primitive — every prepared
      // statement runs in a single SQLite transaction, so a partial
      // failure inside the batch leaves the schema untouched. The
      // closing INSERT into schema_migrations rides along, marking
      // the version applied iff every preceding statement succeeded.
      await db.batch(upStatements.map((s) => db.prepare(s)));
      appliedThisRun.push(migration);
    } catch (err) {
      const upErrMsg = err instanceof Error ? err.message : String(err);
      // Roll back every migration this call applied so the DB lands
      // back where it started. Each DOWN runs in its own batch
      // (transaction). Failures during rollback are swallowed and
      // logged — the caller will see the original UP error and is
      // expected to surface a "DB partially rolled back, reach out
      // for support" message when that happens.
      await rollbackMigrations(db, appliedThisRun);
      throw new Error(
        `Failed to apply migration ${migration.version}: ${upErrMsg}`
      );
    }
  }

  const missing = await missingBaselineTables(db);
  if (missing.length === 0) return;

  if (options.repairLegacyLocalBaseline) {
    console.warn(
      `Local D1 schema is missing clean-baseline tables (${missing.join(
        ', '
      )}); resetting the local development schema.`
    );
    await resetLocalBaseline(db);
    const stillMissing = await missingBaselineTables(db);
    if (stillMissing.length === 0) return;
    throw new Error(
      `Local D1 baseline repair did not create required tables: ${stillMissing.join(
        ', '
      )}`
    );
  }

  throw new Error(
    `D1 schema is missing required clean-baseline tables: ${missing.join(
      ', '
    )}. If this is local development, start the app from a local hostname so the dev-only baseline repair can run.`
  );
}

async function missingBaselineTables(db: D1Database): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN (${REQUIRED_BASELINE_TABLES.map(
         () => '?'
       ).join(',')})`
    )
    .bind(...REQUIRED_BASELINE_TABLES)
    .all<{ name: string }>();

  const existing = new Set((rows.results ?? []).map((row) => row.name));
  return REQUIRED_BASELINE_TABLES.filter((table) => !existing.has(table));
}

async function resetLocalBaseline(db: D1Database): Promise<void> {
  const baseline = MIGRATIONS[0];
  const { up, down } = splitMigration(baseline.sql);
  const statements = [
    ...LEGACY_LOCAL_TABLE_DROPS,
    ...splitStatements(down),
    ...splitStatements(up),
  ];
  await db.batch(statements.map((statement) => db.prepare(statement)));
}

/**
 * Walk `applied` in reverse and run each migration's DOWN section.
 * Best-effort: a DOWN failure is logged but does not stop the loop,
 * because the caller is already in the failure path and we want to
 * undo as much as possible. The first DOWN error is rethrown after
 * the loop so the caller can include it in the surfaced error.
 */
async function rollbackMigrations(
  db: D1Database,
  applied: Migration[]
): Promise<void> {
  for (let i = applied.length - 1; i >= 0; i--) {
    const migration = applied[i];
    const { down } = splitMigration(migration.sql);
    if (down.trim().length === 0) {
      console.error(
        `Migration ${migration.version} has no DOWN section — cannot roll back`
      );
      continue;
    }
    const downStatements = splitStatements(down);
    if (downStatements.length === 0) continue;
    try {
      await db.batch(downStatements.map((s) => db.prepare(s)));
    } catch (rollbackErr) {
      console.error(
        `DOWN for ${migration.version} failed:`,
        rollbackErr instanceof Error
          ? rollbackErr.message
          : String(rollbackErr)
      );
      // Keep going; surface only via the log.
    }
  }
}

/**
 * Split a migration file into UP (everything before the `-- DOWN:`
 * marker) and DOWN (everything after). The marker line itself is
 * discarded. A file without the marker returns the whole content as
 * UP and an empty DOWN.
 */
function splitMigration(sql: string): { up: string; down: string } {
  const lines = sql.split('\n');
  const idx = lines.findIndex((line) => line.trim().startsWith(DOWN_MARKER));
  if (idx === -1) {
    return { up: sql, down: '' };
  }
  return {
    up: lines.slice(0, idx).join('\n'),
    down: lines.slice(idx + 1).join('\n'),
  };
}

/**
 * Split a migration SQL blob into individual statements ready for
 * `db.prepare()`. Strips line + block comments, splits on `;`, drops
 * empty fragments. Doesn't try to be a full SQL parser — string
 * literals containing semicolons would confuse it, but our migration
 * files don't carry any.
 */
function splitStatements(sql: string): string[] {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '') // /* block comments */
    .replace(/--[^\n]*/g, '') //         -- line comments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
