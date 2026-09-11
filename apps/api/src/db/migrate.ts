import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SqliteDatabase } from './connection';
import { DEFAULT_SEEDS, type MigrationSeed } from './seeds';

/** `001_initial.sql` — a zero-padded version, an underscore, a slug. */
const MIGRATION_FILENAME = /^(\d+)_([A-Za-z0-9_-]+)\.sql$/;

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly filename: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly appliedAt: string;
  readonly checksum: string;
}

export interface MigrateResult {
  /** Migrations applied by this call, oldest first. Empty on a no-op run. */
  readonly applied: readonly AppliedMigration[];
  /** Migrations that were already recorded before this call. */
  readonly skipped: number;
}

export class MigrationError extends Error {
  constructor(
    readonly filename: string,
    reason: string,
  ) {
    super(`Migration '${filename}' cannot be applied: ${reason}.`);
    this.name = 'MigrationError';
  }
}

export class MigrationChecksumError extends Error {
  constructor(
    readonly version: number,
    readonly migrationName: string,
  ) {
    super(
      `Migration ${String(version)} ('${migrationName}') has changed since it was applied. ` +
        'An applied migration is history and cannot be edited — add a new one instead.',
    );
    this.name = 'MigrationChecksumError';
  }
}

/**
 * Hash the statements, not the bytes.
 *
 * Line endings are normalised first so a repository checked out with CRLF on
 * Windows does not read as a different migration from the same file on Linux.
 */
function checksumOf(sql: string): string {
  const normalised = sql.replace(/\r\n/g, '\n').trim();
  return createHash('sha256').update(normalised, 'utf8').digest('hex');
}

/** `apps/api/migrations`, resolved relative to this module rather than cwd. */
export function defaultMigrationsDirectory(): string {
  return fileURLToPath(new URL('../../migrations/', import.meta.url));
}

export function loadMigrations(
  directory: string = defaultMigrationsDirectory(),
): readonly Migration[] {
  const migrations: Migration[] = [];
  const seen = new Map<number, string>();

  for (const filename of readdirSync(directory).sort()) {
    if (!filename.endsWith('.sql')) {
      continue;
    }

    const match = MIGRATION_FILENAME.exec(filename);
    if (match === null) {
      throw new MigrationError(
        filename,
        'the name must be a number, an underscore, and a slug, as in 001_initial.sql',
      );
    }

    const version = Number(match[1]);
    const name = match[2] ?? '';

    const clash = seen.get(version);
    if (clash !== undefined) {
      throw new MigrationError(
        filename,
        `version ${String(version)} is already taken by '${clash}'`,
      );
    }
    seen.set(version, filename);

    const sql = readFileSync(path.join(directory, filename), 'utf8');
    migrations.push({
      version,
      name,
      filename,
      sql,
      checksum: checksumOf(sql),
    });
  }

  return migrations.sort((left, right) => left.version - right.version);
}

/**
 * Bring a database up to date, and do nothing at all if it already is.
 *
 * Each migration runs inside its own transaction, so a failure half way
 * through a file leaves that file unapplied rather than half-applied, and the
 * migrations before it stay applied. The bookkeeping row is written inside the
 * same transaction as the statements it describes, which is what makes the
 * whole thing idempotent: either both landed or neither did.
 *
 * A migration whose contents changed after it was applied is an error rather
 * than a silent re-run. The file is a record of what the database already did.
 *
 * A migration may also carry a *seed* — code that runs after its statements
 * and inside the same transaction. That exists for exactly one kind of row:
 * one whose value cannot be written as SQL text. See `seeds.ts`; the admin
 * credential is the case, because its salt must differ per installation.
 * Seeds are matched by filename rather than version number so a throwaway
 * migration directory in a test cannot collide with one.
 */
export function migrate(
  database: SqliteDatabase,
  directory: string = defaultMigrationsDirectory(),
  seeds: readonly MigrationSeed[] = DEFAULT_SEEDS,
): MigrateResult {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const readApplied = database.prepare<[], Record<string, unknown>>(
    'SELECT version, name, checksum, applied_at FROM schema_migrations',
  );
  const recordApplied = database.prepare<[number, string, string, string]>(
    'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );

  const already = new Map<number, { name: string; checksum: string }>();
  for (const row of readApplied.all()) {
    already.set(Number(row['version']), {
      name: String(row['name']),
      checksum: String(row['checksum']),
    });
  }

  const applied: AppliedMigration[] = [];

  for (const migration of loadMigrations(directory)) {
    const previous = already.get(migration.version);

    if (previous !== undefined) {
      if (previous.checksum !== migration.checksum) {
        throw new MigrationChecksumError(migration.version, migration.name);
      }
      continue;
    }

    const appliedAt = new Date().toISOString();

    const seed = seeds.find((one) => one.filename === migration.filename);

    const run = database.transaction(() => {
      database.exec(migration.sql);
      seed?.apply(database);
      recordApplied.run(
        migration.version,
        migration.name,
        migration.checksum,
        appliedAt,
      );
    });

    run();

    applied.push({
      version: migration.version,
      name: migration.name,
      checksum: migration.checksum,
      appliedAt,
    });
  }

  return { applied, skipped: already.size };
}
