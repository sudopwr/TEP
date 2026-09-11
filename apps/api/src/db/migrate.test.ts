import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
      expect(result.applied.map((one) => one.version)).toEqual([1, 2]);
      expect(applied().map((row) => Number(row.version))).toEqual([1, 2]);
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
      expect(second.skipped).toBe(2);
      expect(applied()).toHaveLength(2);
    });

    it('is idempotent across a reconnect to the same file', () => {
      // The in-memory case cannot reopen, so this one uses a real file.
      const directory = mkdtempSync(path.join(tmpdir(), 'payout-migrate-'));
      const file = path.join(directory, 'app.db');

      const first = openDatabase(file);
      expect(migrate(first).applied).toHaveLength(2);
      first.close();

      const second = openDatabase(file);
      expect(migrate(second).applied).toEqual([]);
      expect(migrate(second).skipped).toBe(2);
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
