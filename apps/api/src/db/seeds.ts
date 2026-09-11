import { hashPasswordSync } from '../auth/argon2-password-hasher';

import type { SqliteDatabase } from './connection';

/**
 * A seed that runs inside one migration's transaction.
 *
 * Some reference data cannot be written as SQL text. The admin credential is
 * the case that forced this to exist: §5a asks for `admin` seeded with an
 * argon2id hash of `admin`, and an argon2id hash contains a random salt, so
 * writing it into `003_auth.sql` would mean committing one fixed hash of a
 * known password to the repository — the same salt in every installation,
 * forever, in a file a migration checksum then makes unchangeable.
 *
 * Computing it here instead means every database gets its own salt, and the
 * checksum still covers the statements that created the tables.
 *
 * `apply` is synchronous because better-sqlite3 transactions are. It runs
 * after the file's statements and before the bookkeeping row is written, so
 * a failing seed rolls the whole migration back.
 */
export interface MigrationSeed {
  /** The migration file this belongs to, matched by exact filename. */
  readonly filename: string;
  apply(database: SqliteDatabase): void;
}

/** The shipped default (§5a). Also the thing F15 refuses to let you keep. */
export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = 'admin';

const INSERT_ADMIN = `
  INSERT INTO users (username, password_hash, must_change_password, created_at)
  VALUES (?, ?, 1, ?)
  ON CONFLICT (username) DO NOTHING
`;

/**
 * Seed `admin` / `admin`, flagged must-change (§5a, F15).
 *
 * A default credential is normally indefensible. It is defensible here only
 * because of the three constraints in §5a — data routes 403 until the flag
 * clears, the server will not leave loopback until it clears, and the UI has
 * no path past the change screen. If any of those is removed, this seed must
 * go with it.
 *
 * `DO NOTHING` rather than a plain insert so that re-seeding a database that
 * somehow already has the row is a no-op rather than a constraint error. The
 * migration runner already guarantees this runs once; this makes it harmless
 * if that guarantee is ever loosened.
 */
export const seedDefaultAdmin: MigrationSeed = {
  filename: '003_auth.sql',

  apply(database: SqliteDatabase): void {
    database
      .prepare(INSERT_ADMIN)
      .run(
        DEFAULT_ADMIN_USERNAME,
        hashPasswordSync(DEFAULT_ADMIN_PASSWORD),
        new Date().toISOString(),
      );
  },
};

/** Every seed the application ships. Order follows migration order. */
export const DEFAULT_SEEDS: readonly MigrationSeed[] = [seedDefaultAdmin];
