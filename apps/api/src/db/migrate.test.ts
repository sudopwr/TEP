import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openTestDatabase } from '../../test/open-test-database';

import { openDatabase, type SqliteDatabase } from './connection';
import {
  defaultMigrationsDirectory,
  loadMigrations,
  migrate,
  MigrationChecksumError,
  MigrationError,
} from './migrate';

interface AppliedRow {
  readonly version: bigint;
  readonly name: string;
}

describe('migrate', () => {
  let database: SqliteDatabase;

  beforeEach(() => {
    database = openDatabase(':memory:');
  });

  afterEach(() => {
    database.close();
  });

  const applied = (): readonly AppliedRow[] =>
    database
      .prepare<[], AppliedRow>(
        'SELECT version, name FROM schema_migrations ORDER BY version',
      )
      .all();

  const tableNames = (): readonly string[] =>
    database
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);

  describe('the real migrations directory', () => {
    it('applies every migration on a fresh database', () => {
      const result = migrate(database);

      expect(result.skipped).toBe(0);
      expect(result.applied.map((one) => one.version)).toEqual([1, 2, 3]);
      expect(applied().map((row) => Number(row.version))).toEqual([1, 2, 3]);
    });

    it('creates the schema, views and full-text index', () => {
      migrate(database);

      expect(tableNames()).toEqual(
        expect.arrayContaining([
          'accounts',
          'companies',
          'currencies',
          'document_links',
          'documents',
          'documents_fts',
          'fee_schedules',
          'payouts',
          'schema_migrations',
          'transaction_fees',
          'transactions',
        ]),
      );
    });

    it('seeds the currency scales CLAUDE.md §6 depends on', () => {
      migrate(database);

      const scales = database
        .prepare<[], { code: string; scale: bigint }>(
          'SELECT code, scale FROM currencies ORDER BY code',
        )
        .all()
        .map((row) => `${row.code}:${String(row.scale)}`);

      expect(scales).toEqual(['INR:2', 'USD:2', 'USDT:8']);
    });

    it('is idempotent — a second run applies nothing', () => {
      migrate(database);
      const second = migrate(database);

      expect(second.applied).toEqual([]);
      expect(second.skipped).toBe(3);
      expect(applied()).toHaveLength(3);
    });

    it('is idempotent across a reconnect to the same file', () => {
      // The in-memory case cannot reopen, so this one uses a real file.
      const directory = mkdtempSync(path.join(tmpdir(), 'payout-migrate-'));
      const file = path.join(directory, 'app.db');

      const first = openDatabase(file);
      expect(migrate(first).applied).toHaveLength(3);
      first.close();

      const second = openDatabase(file);
      expect(migrate(second).applied).toEqual([]);
      expect(migrate(second).skipped).toBe(3);
      second.close();
    });

    it('turns WAL on for a file database', () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'payout-wal-'));
      const connection = openDatabase(path.join(directory, 'app.db'));

      expect(connection.pragma('journal_mode', { simple: true })).toBe('wal');
      connection.close();
    });

    it('loads migrations in version order, not filename order', () => {
      const versions = loadMigrations(defaultMigrationsDirectory()).map(
        (one) => one.version,
      );

      expect(versions).toEqual([...versions].sort((a, b) => a - b));
    });
  });

  describe('a directory of its own', () => {
    const write = (files: Record<string, string>): string => {
      const directory = mkdtempSync(path.join(tmpdir(), 'payout-migrations-'));
      for (const [name, sql] of Object.entries(files)) {
        writeFileSync(path.join(directory, name), sql, 'utf8');
      }
      return directory;
    };

    it('applies files in numeric order even when the names sort badly', () => {
      // 10 sorts before 2 as text — the same trap §9 records in the sheet.
      const directory = write({
        '001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
        '002_b.sql': 'CREATE TABLE b (id INTEGER PRIMARY KEY);',
        '010_c.sql': 'INSERT INTO b (id) VALUES (1);',
      });

      expect(loadMigrations(directory).map((one) => one.filename)).toEqual([
        '001_a.sql',
        '002_b.sql',
        '010_c.sql',
      ]);
      expect(() => migrate(database, directory)).not.toThrow();
    });

    it('applies only what is new when a migration is added later', () => {
      const directory = write({
        '001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
      });
      migrate(database, directory);

      writeFileSync(
        path.join(directory, '002_b.sql'),
        'CREATE TABLE b (id INTEGER PRIMARY KEY);',
        'utf8',
      );

      const second = migrate(database, directory);

      expect(second.applied.map((one) => one.version)).toEqual([2]);
      expect(second.skipped).toBe(1);
    });

    it('rolls the whole file back when one statement in it fails', () => {
      const directory = write({
        '001_a.sql': `CREATE TABLE a (id INTEGER PRIMARY KEY);
                      CREATE TABLE a (id INTEGER PRIMARY KEY);`,
      });

      expect(() => migrate(database, directory)).toThrow();
      // Neither the table from the first statement nor the bookkeeping row.
      expect(tableNames()).not.toContain('a');
      expect(applied()).toEqual([]);
    });

    it('refuses a migration that changed after it was applied', () => {
      const directory = write({
        '001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
      });
      migrate(database, directory);

      writeFileSync(
        path.join(directory, '001_a.sql'),
        'CREATE TABLE a (id INTEGER PRIMARY KEY, extra TEXT);',
        'utf8',
      );

      expect(() => migrate(database, directory)).toThrow(
        MigrationChecksumError,
      );
    });

    it('ignores a line-ending change, which is not a content change', () => {
      const directory = write({
        '001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);\n',
      });
      migrate(database, directory);

      writeFileSync(
        path.join(directory, '001_a.sql'),
        'CREATE TABLE a (id INTEGER PRIMARY KEY);\r\n',
        'utf8',
      );

      expect(() => migrate(database, directory)).not.toThrow();
    });

    it('refuses two files claiming the same version', () => {
      const directory = write({
        '001_a.sql': 'SELECT 1;',
        '001_b.sql': 'SELECT 1;',
      });

      expect(() => loadMigrations(directory)).toThrow(MigrationError);
    });

    it('refuses a file that is not named like a migration', () => {
      const directory = write({ 'oops.sql': 'SELECT 1;' });

      expect(() => loadMigrations(directory)).toThrow(MigrationError);
    });

    it('ignores files that are not .sql at all', () => {
      const directory = write({
        '001_a.sql': 'CREATE TABLE a (id INTEGER PRIMARY KEY);',
        'README.md': 'not a migration',
      });

      expect(loadMigrations(directory)).toHaveLength(1);
    });
  });
});

describe('recovering a forgotten password', () => {
  /**
   * The procedure the README documents, run end to end.
   *
   * There is no password-reset flow and there should not be — a single-user
   * local tool has nowhere to mail a link. What it has instead is the
   * database: delete the row and start the application. That only works if
   * migrating a database whose migrations have all already run still puts the
   * credential back, which is what `isMissing` is for.
   */
  it('re-seeds the shipped credential when the users table is empty', () => {
    const database = openTestDatabase();

    try {
      migrate(database);
      database.exec('DELETE FROM users');

      const result = migrate(database);

      expect(result.applied).toEqual([]);
      expect(result.repaired).toEqual(['003_auth.sql']);

      const row = database
        .prepare('SELECT username, must_change_password FROM users')
        .get() as { username: string; must_change_password: bigint };

      expect(row.username).toBe('admin');
      // And the cage comes back with it, or the recovery would be a hole.
      expect(Number(row.must_change_password)).toBe(1);
    } finally {
      database.close();
    }
  });

  it('takes the sessions with it, so no old cookie survives the reset', () => {
    // `sessions.user_id` cascades. Worth asserting: a session that outlived
    // the account it belonged to would be a way past the new cage.
    const database = openTestDatabase();

    try {
      migrate(database);
      database
        .prepare(
          'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, 1, ?, ?)',
        )
        .run('a-session', '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z');

      database.exec('DELETE FROM users');
      migrate(database);

      const sessions = database
        .prepare('SELECT COUNT(*) AS n FROM sessions')
        .get() as { n: bigint };

      expect(Number(sessions.n)).toBe(0);
    } finally {
      database.close();
    }
  });

  it('leaves a renamed account alone', () => {
    // F16 lets the owner rename themselves. A database with one user called
    // `kd` is healthy, and adding an `admin` beside them would be a back door.
    const database = openTestDatabase();

    try {
      migrate(database);
      database.prepare('UPDATE users SET username = ?').run('kd');

      const result = migrate(database);

      expect(result.repaired).toEqual([]);
      expect(
        database.prepare('SELECT COUNT(*) AS n FROM users').get(),
      ).toMatchObject({ n: 1n });
    } finally {
      database.close();
    }
  });
});
