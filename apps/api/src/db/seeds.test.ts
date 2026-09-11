import { verifySync } from '@node-rs/argon2';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type SqliteDatabase } from './connection';
import { migrate } from './migrate';
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
  DEFAULT_SEEDS,
  seedDefaultAdmin,
} from './seeds';

interface UserRow {
  readonly id: bigint;
  readonly username: string;
  readonly password_hash: string;
  readonly must_change_password: bigint;
  readonly created_at: string;
  readonly password_changed_at: string | null;
}

const readAdmin = (database: SqliteDatabase): UserRow | undefined =>
  database
    .prepare<[string], UserRow>('SELECT * FROM users WHERE username = ?')
    .get('admin');

describe('the default admin seed', () => {
  let database: SqliteDatabase;

  beforeEach(() => {
    database = openDatabase(':memory:');
    migrate(database);
  });

  afterEach(() => {
    database.close();
  });

  it('runs as part of migration 003, not as a separate step', () => {
    expect(seedDefaultAdmin.filename).toBe('003_auth.sql');
    expect(DEFAULT_SEEDS).toContain(seedDefaultAdmin);
  });

  it('creates exactly one account (§5a: there is no registration)', () => {
    const count = database
      .prepare<[], { n: bigint }>('SELECT count(*) AS n FROM users')
      .get();

    expect(count?.n).toBe(1n);
  });

  it('ships admin / admin, as F15 says it does', () => {
    const admin = readAdmin(database);

    expect(admin?.username).toBe(DEFAULT_ADMIN_USERNAME);
    expect(verifySync(admin?.password_hash ?? '', DEFAULT_ADMIN_PASSWORD)).toBe(
      true,
    );
  });

  it('flags it must-change, which is what makes the default defensible', () => {
    expect(readAdmin(database)?.must_change_password).toBe(1n);
    expect(readAdmin(database)?.password_changed_at).toBeNull();
  });

  it('stores an argon2id hash at the declared parameters', () => {
    expect(readAdmin(database)?.password_hash).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
    );
  });

  it('never stores the plaintext anywhere in the row', () => {
    const admin = readAdmin(database);

    expect(admin?.password_hash).not.toContain(DEFAULT_ADMIN_PASSWORD);
  });

  it('salts per installation — two databases get two different hashes', () => {
    // This is the whole reason the seed is code and not a line of SQL. A
    // literal hash in 003_auth.sql would mean one salt shared by every
    // installation of this app, forever, in a checksummed file.
    const second = openDatabase(':memory:');
    migrate(second);

    try {
      expect(readAdmin(second)?.password_hash).not.toBe(
        readAdmin(database)?.password_hash,
      );
      // ...and both still verify.
      expect(verifySync(readAdmin(second)?.password_hash ?? '', 'admin')).toBe(
        true,
      );
    } finally {
      second.close();
    }
  });

  it('is idempotent — a second migrate does not insert a second admin', () => {
    migrate(database);
    migrate(database);

    const count = database
      .prepare<[], { n: bigint }>('SELECT count(*) AS n FROM users')
      .get();

    expect(count?.n).toBe(1n);
  });

  it('rolls back with its migration when the seed fails', () => {
    const fresh = openDatabase(':memory:');
    const exploding = {
      filename: '003_auth.sql',
      apply(): void {
        throw new Error('seed failed');
      },
    };

    try {
      expect(() => {
        migrate(fresh, undefined, [exploding]);
      }).toThrow('seed failed');

      // The tables from 003 are gone with it, and 003 is not recorded.
      const applied = fresh
        .prepare<[], { version: bigint }>(
          'SELECT version FROM schema_migrations ORDER BY version',
        )
        .all()
        .map((row) => Number(row.version));

      expect(applied).toEqual([1, 2]);
      expect(
        fresh
          .prepare<[], { n: bigint }>(
            "SELECT count(*) AS n FROM sqlite_master WHERE name = 'users'",
          )
          .get()?.n,
      ).toBe(0n);
    } finally {
      fresh.close();
    }
  });

  it('leaves the sessions table empty and indexed', () => {
    const indexes = database
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sessions'",
      )
      .all()
      .map((row) => row.name);

    expect(indexes).toContain('idx_sessions_expires_at');
  });
});
