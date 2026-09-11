import type { IsoInstant, SessionId, UserId } from '../../src/domain/ids';
import type { Session } from '../../src/domain/session';
import type { SessionRepository } from '../../src/ports/session-repository';

export class FakeSessionRepository implements SessionRepository {
  readonly #rows = new Map<SessionId, Session>();

  seed(...sessions: readonly Session[]): this {
    for (const session of sessions) {
      this.#rows.set(session.id, session);
    }
    return this;
  }

  findById(id: SessionId): Promise<Session | null> {
    return Promise.resolve(this.#rows.get(id) ?? null);
  }

  insert(session: Session): Promise<Session> {
    if (this.#rows.has(session.id)) {
      // The real table has a PRIMARY KEY. A fake that quietly overwrote would
      // hide a duplicate-id bug that SQLite would catch.
      return Promise.reject(
        new Error(`session '${session.id}' already exists`),
      );
    }
    this.#rows.set(session.id, session);
    return Promise.resolve(session);
  }

  update(session: Session): Promise<Session> {
    this.#rows.set(session.id, session);
    return Promise.resolve(session);
  }

  listForUser(userId: UserId): Promise<readonly Session[]> {
    const mine = [...this.#rows.values()].filter(
      (session) => session.userId === userId,
    );
    mine.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return Promise.resolve(mine);
  }

  revokeAllForUser(
    userId: UserId,
    at: IsoInstant,
    exceptSessionId?: SessionId,
  ): Promise<number> {
    let revoked = 0;

    for (const session of this.#rows.values()) {
      if (
        session.userId !== userId ||
        session.id === exceptSessionId ||
        session.isRevoked()
      ) {
        continue;
      }
      this.#rows.set(session.id, session.revoked(new Date(at)));
      revoked += 1;
    }

    return Promise.resolve(revoked);
  }

  deleteExpiredBefore(before: IsoInstant): Promise<number> {
    let deleted = 0;

    for (const session of [...this.#rows.values()]) {
      if (session.expiresAt < before) {
        this.#rows.delete(session.id);
        deleted += 1;
      }
    }

    return Promise.resolve(deleted);
  }

  size(): number {
    return this.#rows.size;
  }
}
