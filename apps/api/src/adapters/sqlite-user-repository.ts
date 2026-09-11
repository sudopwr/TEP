import type { User, UserDraft, UserId, UserRepository } from '@payout/core';

import type { SqliteDatabase } from '../db/connection';

import { toUser, type UserRow } from './mappers';

const COLUMNS =
  'id, username, password_hash, must_change_password, created_at, password_changed_at';

const SQL = {
  selectById: `SELECT ${COLUMNS} FROM users WHERE id = ?`,
  selectByUsername: `SELECT ${COLUMNS} FROM users WHERE username = ?`,
  count: 'SELECT count(*) AS total FROM users',
  insert: `
    INSERT INTO users (username, password_hash, must_change_password, created_at, password_changed_at)
    VALUES (@username, @passwordHash, @mustChangePassword, @createdAt, @passwordChangedAt)
  `,
  update: `
    UPDATE users
       SET username = @username,
           password_hash = @passwordHash,
           must_change_password = @mustChangePassword,
           password_changed_at = @passwordChangedAt
     WHERE id = @id
  `,
} as const;

interface WriteParams {
  username: string;
  passwordHash: string;
  mustChangePassword: number;
  createdAt: string;
  passwordChangedAt: string | null;
}

/**
 * The users table, which holds exactly one row (§5a).
 *
 * `created_at` is deliberately absent from the update statement: when the
 * account was created is a fact, not a field, and an UPDATE that could move
 * it is one careless mapper away from moving it.
 */
export class SqliteUserRepository implements UserRepository {
  readonly #selectById;
  readonly #selectByUsername;
  readonly #count;
  readonly #insert;
  readonly #update;

  constructor(database: SqliteDatabase) {
    this.#selectById = database.prepare<[number], UserRow>(SQL.selectById);
    this.#selectByUsername = database.prepare<[string], UserRow>(
      SQL.selectByUsername,
    );
    this.#count = database.prepare<[], { total: bigint }>(SQL.count);
    this.#insert = database.prepare<WriteParams>(SQL.insert);
    this.#update = database.prepare<WriteParams & { id: number }>(SQL.update);
  }

  async findById(id: UserId): Promise<User | null> {
    const row = this.#selectById.get(id);
    return Promise.resolve(row === undefined ? null : toUser(row));
  }

  async findByUsername(username: string): Promise<User | null> {
    const row = this.#selectByUsername.get(username);
    return Promise.resolve(row === undefined ? null : toUser(row));
  }

  async insert(draft: UserDraft): Promise<User> {
    const result = this.#insert.run({
      username: draft.username,
      passwordHash: draft.passwordHash,
      mustChangePassword: draft.mustChangePassword ? 1 : 0,
      createdAt: draft.createdAt,
      passwordChangedAt: draft.passwordChangedAt,
    });

    return this.#require(Number(result.lastInsertRowid));
  }

  async update(user: User): Promise<User> {
    this.#update.run({
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      mustChangePassword: user.mustChangePassword ? 1 : 0,
      createdAt: user.createdAt,
      passwordChangedAt: user.passwordChangedAt,
    });

    return this.#require(user.id);
  }

  async count(): Promise<number> {
    return Promise.resolve(Number(this.#count.get()?.total ?? 0n));
  }

  async #require(id: UserId): Promise<User> {
    const row = this.#selectById.get(id);
    if (row === undefined) {
      throw new Error(`users row ${String(id)} vanished after writing it`);
    }
    return Promise.resolve(toUser(row));
  }
}
