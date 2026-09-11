import { timingSafeEqual } from 'node:crypto';

import type {
  IsoInstant,
  Session,
  SessionId,
  SessionRepository,
  UserId,
} from '@payout/core';

import type { SqliteDatabase } from '../db/connection';

import { toSession, type SessionRow } from './mappers';

const COLUMNS = 'id, user_id, created_at, expires_at, revoked_at';

const SQL = {
  selectById: `SELECT ${COLUMNS} FROM sessions WHERE id = ?`,
  selectForUser: `SELECT ${COLUMNS} FROM sessions WHERE user_id = ? ORDER BY created_at DESC, id`,
  insert: `
    INSERT INTO sessions (id, user_id, created_at, expires_at, revoked_at)
    VALUES (@id, @userId, @createdAt, @expiresAt, @revokedAt)
  `,
  update: `
    UPDATE sessions
       SET expires_at = @expiresAt,
           revoked_at = @revokedAt
     WHERE id = @id
  `,
  revokeAllForUser: `
    UPDATE sessions
       SET revoked_at = @at
     WHERE user_id = @userId
       AND revoked_at IS NULL
       AND id <> @except
  `,
  deleteExpiredBefore: 'DELETE FROM sessions WHERE expires_at < ?',
} as const;

/**
 * Compare two session ids without leaking how far they matched.
 *
 * Honest about what this does and does not buy. The B-tree lookup that found
 * the row is itself not constant-time, so this is not a complete defence
 * against a timing oracle — a complete one would mean scanning the whole
 * table on every request, which for a single-user local app buys nothing.
 * What it does guarantee is that the comparison *this code* performs is
 * constant-time, as §5a requires, and that a row whose id differs from the
 * one presented can never be returned. With a 256-bit random id the practical
 * risk was already negligible; the rule exists so nobody later substitutes a
 * 6-digit code and keeps the `===`.
 */
function sameSessionId(stored: string, presented: string): boolean {
  const left = Buffer.from(stored, 'utf8');
  const right = Buffer.from(presented, 'utf8');

  // timingSafeEqual throws on a length mismatch, which is itself a signal —
  // but the length of a session id is not a secret, only its contents are.
  return left.length === right.length && timingSafeEqual(left, right);
}

export class SqliteSessionRepository implements SessionRepository {
  readonly #selectById;
  readonly #selectForUser;
  readonly #insert;
  readonly #update;
  readonly #revokeAllForUser;
  readonly #deleteExpiredBefore;

  constructor(database: SqliteDatabase) {
    this.#selectById = database.prepare<[string], SessionRow>(SQL.selectById);
    this.#selectForUser = database.prepare<[number], SessionRow>(
      SQL.selectForUser,
    );
    this.#insert = database.prepare<{
      id: string;
      userId: number;
      createdAt: string;
      expiresAt: string;
      revokedAt: string | null;
    }>(SQL.insert);
    this.#update = database.prepare<{
      id: string;
      expiresAt: string;
      revokedAt: string | null;
    }>(SQL.update);
    this.#revokeAllForUser = database.prepare<{
      userId: number;
      at: string;
      except: string;
    }>(SQL.revokeAllForUser);
    this.#deleteExpiredBefore = database.prepare<[string]>(
      SQL.deleteExpiredBefore,
    );
  }

  async findById(id: SessionId): Promise<Session | null> {
    const row = this.#selectById.get(id);

    if (row === undefined || !sameSessionId(row.id, id)) {
      return Promise.resolve(null);
    }

    return Promise.resolve(toSession(row));
  }

  async insert(session: Session): Promise<Session> {
    this.#insert.run({
      id: session.id,
      userId: session.userId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
    });

    return this.#require(session.id);
  }

  async update(session: Session): Promise<Session> {
    // The id, the user and the creation stamp are not updatable: a session
    // can be extended or revoked, and nothing else can happen to it.
    this.#update.run({
      id: session.id,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
    });

    return this.#require(session.id);
  }

  async listForUser(userId: UserId): Promise<readonly Session[]> {
    return Promise.resolve(this.#selectForUser.all(userId).map(toSession));
  }

  async revokeAllForUser(
    userId: UserId,
    at: IsoInstant,
    exceptSessionId?: SessionId,
  ): Promise<number> {
    // One statement, so "revoke everything but this one" cannot interleave
    // with a request that is authenticating against one of those rows.
    // `id <> @except` with a sentinel rather than two statements: SQLite's
    // <> is false for NULL, which would silently spare nothing at all.
    const result = this.#revokeAllForUser.run({
      userId,
      at,
      except: exceptSessionId ?? '',
    });

    return Promise.resolve(result.changes);
  }

  async deleteExpiredBefore(before: IsoInstant): Promise<number> {
    return Promise.resolve(this.#deleteExpiredBefore.run(before).changes);
  }

  async #require(id: SessionId): Promise<Session> {
    const row = this.#selectById.get(id);
    if (row === undefined) {
      throw new Error(`sessions row '${id}' vanished after writing it`);
    }
    return Promise.resolve(toSession(row));
  }
}
