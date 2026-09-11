import type { IsoInstant, SessionId, UserId } from '../domain/ids';
import type { Session } from '../domain/session';

export interface SessionRepository {
  /**
   * Look up a session by its id, or null.
   *
   * The id is a bearer secret, so the implementation compares it in constant
   * time (§5a). An expired or revoked row is still returned — deciding what
   * an unusable session means is UC12's job, not the storage layer's.
   */
  findById(id: SessionId): Promise<Session | null>;

  insert(session: Session): Promise<Session>;

  update(session: Session): Promise<Session>;

  /** Every session for a user, newest first. Revoked and expired included. */
  listForUser(userId: UserId): Promise<readonly Session[]>;

  /**
   * Revoke every live session for a user, optionally sparing one.
   *
   * Exists as one call rather than a read-modify-write loop because UC13 uses
   * it after a password change, and "revoke all but this one" has to be a
   * single statement to be atomic. Returns how many rows it revoked.
   */
  revokeAllForUser(
    userId: UserId,
    at: IsoInstant,
    exceptSessionId?: SessionId,
  ): Promise<number>;

  /** Housekeeping: drop rows that expired before `before`. Returns the count. */
  deleteExpiredBefore(before: IsoInstant): Promise<number>;
}
