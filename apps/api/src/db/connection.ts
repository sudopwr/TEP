import Database from 'better-sqlite3';

export type SqliteDatabase = Database.Database;

export interface OpenDatabaseOptions {
  /** Milliseconds to wait on a locked database before giving up. */
  readonly busyTimeoutMs?: number;
  readonly readonly?: boolean;
}

/**
 * Open a connection with the pragmas this application depends on.
 *
 * `foreign_keys` is off by default in SQLite and is a per-connection setting,
 * so it has to be set here rather than in the schema — a migration that turns
 * it on affects only the connection that ran the migration. §7's invariants
 * are only invariants because of this line.
 *
 * `journal_mode = WAL` is persistent once set on a file database. It is not
 * supported for `:memory:`, where SQLite silently keeps its own journal mode;
 * that is harmless, and the tests read the pragma back rather than assuming.
 *
 * `defaultSafeIntegers` makes every INTEGER column arrive as a bigint. That
 * is the point: a money column must never pass through a float64 on its way
 * out of the database, and `Money.fromMinor` takes a bigint directly. Columns
 * that are genuinely small — ids, scales, byte sizes — are narrowed back with
 * an explicit `Number()` in the mappers, where the narrowing is visible.
 */
export function openDatabase(
  location: string,
  options: OpenDatabaseOptions = {},
): SqliteDatabase {
  const database = new Database(location, {
    readonly: options.readonly ?? false,
  });

  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma(`busy_timeout = ${String(options.busyTimeoutMs ?? 5000)}`);
  database.defaultSafeIntegers(true);

  return database;
}
