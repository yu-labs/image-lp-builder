#!/usr/bin/env node
/**
 * Round-trip integrity test for `migrations/*.sql`.
 *
 * Drives each file through UP -> DOWN -> UP against a throwaway
 * SQLite database, mimicking the runtime D1 path used in
 * src/lib/migrations.ts. Catches the typical mistake of writing
 * reverse SQL that doesn't actually undo the forward migration: if
 * any step throws, the script fails and prints the migration that
 * broke.
 *
 * Run via `node scripts/migration-roundtrip.mjs` from the project
 * root. Uses the system `sqlite3` binary (no extra npm deps required).
 *
 * What is tested:
 *   STEP A — every migration applies forward (UP) on a fresh database.
 *   STEP B — every migration's DOWN reverses without error, in reverse
 *            order. (0001's DOWN nukes the schema entirely; that's the
 *            pre-installation state, so it's expected.)
 *   STEP C — after full rollback, all migrations re-apply forward.
 *            Schema after second UP must equal schema after first UP.
 *   STEP D — partial UP/DOWN cycles: apply N files then roll back
 *            only the last, for each N from 1 to count-1.
 */

import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);
const migrationsDir = join(projectRoot, 'migrations');

const DOWN_MARKER = '-- DOWN:';

function splitMigration(sql) {
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

function loadMigrations() {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  return files.map((file) => {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    const { up, down } = splitMigration(sql);
    return { file, up, down };
  });
}

function runSql(dbPath, sql, label) {
  if (sql.trim().length === 0) return;
  const res = spawnSync('sqlite3', [dbPath], {
    input: sql,
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    const stderr = (res.stderr || '').trim();
    throw new Error(`${label} failed:\n${stderr}\n\n--- SQL ---\n${sql}`);
  }
}

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'migration-roundtrip-'));
  const dbPath = join(dir, 'roundtrip.db');
  return { dir, dbPath };
}

function tableSchema(dbPath) {
  // Sort by type/name so the output is stable regardless of creation
  // order.
  const out = execSync(
    `sqlite3 "${dbPath}" "SELECT type || '|' || name || '|' || COALESCE(sql, '') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"`,
    { encoding: 'utf-8' }
  );
  return out.trim();
}

function main() {
  const migrations = loadMigrations();
  console.log(`Loaded ${migrations.length} migration files.\n`);

  // STEP A: forward
  const { dir: dir1, dbPath: db1 } = fresh();
  try {
    console.log('STEP A - forward UP (clean DB):');
    for (const m of migrations) {
      console.log(`  applying ${m.file}`);
      runSql(db1, m.up, `UP ${m.file}`);
    }
    const schemaAfterFirstUp = tableSchema(db1);

    // STEP B: full rollback
    console.log('\nSTEP B - DOWN in reverse order:');
    for (let i = migrations.length - 1; i >= 0; i--) {
      const m = migrations[i];
      if (m.down.trim().length === 0) {
        console.log(`  skipping ${m.file} (no DOWN section)`);
        continue;
      }
      console.log(`  rolling back ${m.file}`);
      runSql(db1, m.down, `DOWN ${m.file}`);
    }

    // STEP C: re-apply forward
    console.log('\nSTEP C - forward UP again (after full rollback):');
    for (const m of migrations) {
      console.log(`  applying ${m.file}`);
      runSql(db1, m.up, `UP-AGAIN ${m.file}`);
    }
    const schemaAfterSecondUp = tableSchema(db1);

    // Sanity check: schema after second UP should match schema after
    // first UP. A drift here means a DOWN section left a residue
    // that the next UP can't recreate cleanly.
    if (schemaAfterFirstUp !== schemaAfterSecondUp) {
      console.error('\nFAIL: schema differs between first and second UP run.');
      console.error('---- after first UP ----');
      console.error(schemaAfterFirstUp);
      console.error('---- after second UP ----');
      console.error(schemaAfterSecondUp);
      process.exit(1);
    }
    console.log('\n  schemas match between first and second UP run.');

    // STEP D: partial rollback. Apply N files, roll back only the
    // last, then drop the database. Verifies that single-file
    // rollback paths also work end-to-end.
    const { dir: dir2, dbPath: db2 } = fresh();
    try {
      console.log('\nSTEP D - partial UP/DOWN cycles:');
      for (let n = 1; n < migrations.length; n++) {
        const subset = migrations.slice(0, n + 1);
        for (const m of subset) runSql(db2, m.up, `UP-SUBSET ${m.file}`);
        const last = subset[subset.length - 1];
        if (last.down.trim().length === 0) {
          // No DOWN to test. Reset and continue.
        } else {
          runSql(db2, last.down, `DOWN-SUBSET ${last.file}`);
        }
        rmSync(db2, { force: true });
      }
      console.log('  partial cycles ok');
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }

    console.log('\nAll steps passed.');
  } finally {
    rmSync(dir1, { recursive: true, force: true });
  }
}

main();
