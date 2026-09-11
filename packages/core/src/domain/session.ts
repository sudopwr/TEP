import type { IsoInstant, SessionId, UserId } from './ids';

export interface SessionProps {
  readonly id: SessionId;
  readonly userId: UserId;
  readonly createdAt: IsoInstant;
  readonly expiresAt: IsoInstant;
  readonly revokedAt: IsoInstant | null;
}

/** Thirty days, per §5a's cookie lifetime. The row and the cookie agree. */
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A server-side session row (§13: "Sessions are server-side rows, not JWTs").
 *
 * Sign-out has to actually revoke, which a stateless token cannot do without
 * building the very table it was meant to avoid. So: a row, a revocation
 * column, and an expiry.
 */
export class Session {
  readonly #props: SessionProps;

  private constructor(props: SessionProps) {
    this.#props = Object.freeze({ ...props });
  }

  static create(props: SessionProps): Session {
    return new Session(props);
  }

  /** A fresh session running from `now` for the standard lifetime. */
  static starting(
    id: SessionId,
    userId: UserId,
    now: Date,
    lifetimeMs: number = SESSION_LIFETIME_MS,
  ): Session {
    return new Session({
      id,
      userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + lifetimeMs).toISOString(),
      revokedAt: null,
    });
  }

  get id(): SessionId {
    return this.#props.id;
  }

  get userId(): UserId {
    return this.#props.userId;
  }

  get createdAt(): IsoInstant {
    return this.#props.createdAt;
  }

  get expiresAt(): IsoInstant {
    return this.#props.expiresAt;
  }

  get revokedAt(): IsoInstant | null {
    return this.#props.revokedAt;
  }

  isRevoked(): boolean {
    return this.#props.revokedAt !== null;
  }

  /** Expiry is exclusive: a session is dead *at* its expiry, not after it. */
  isExpired(now: Date): boolean {
    return now.getTime() >= Date.parse(this.#props.expiresAt);
  }

  isActive(now: Date): boolean {
    return !this.isRevoked() && !this.isExpired(now);
  }

  /**
   * Past the halfway mark of its life — UC12's cue to extend it.
   *
   * Extending on every request would write a row on every request. Extending
   * at the halfway point means somebody using the app daily never gets logged
   * out, and somebody who stops using it still expires on schedule.
   */
  isPastHalfLife(now: Date): boolean {
    const created = Date.parse(this.#props.createdAt);
    const expires = Date.parse(this.#props.expiresAt);
    return now.getTime() >= created + (expires - created) / 2;
  }

  /** A new expiry, measured from `now`. The created-at stamp does not move. */
  extendedFrom(now: Date, lifetimeMs: number = SESSION_LIFETIME_MS): Session {
    return new Session({
      ...this.#props,
      expiresAt: new Date(now.getTime() + lifetimeMs).toISOString(),
    });
  }

  /** Idempotent: revoking an already-revoked session keeps the first stamp. */
  revoked(at: Date): Session {
    if (this.isRevoked()) {
      return this;
    }
    return new Session({ ...this.#props, revokedAt: at.toISOString() });
  }

  equals(other: Session): boolean {
    return this.#props.id === other.id;
  }

  /** The id is a bearer secret. It does not belong in a serialised payload. */
  toJSON(): Record<string, unknown> {
    return {
      userId: this.#props.userId,
      createdAt: this.#props.createdAt,
      expiresAt: this.#props.expiresAt,
      revokedAt: this.#props.revokedAt,
    };
  }
}
