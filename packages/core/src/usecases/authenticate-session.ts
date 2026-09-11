import { SessionInvalidError } from '../domain/errors';
import type { SessionId } from '../domain/ids';
import { SESSION_LIFETIME_MS, type Session } from '../domain/session';
import type { User } from '../domain/user';
import type { Clock } from '../ports/clock';
import type { SessionRepository } from '../ports/session-repository';
import type { UserRepository } from '../ports/user-repository';

export interface AuthenticateSessionDependencies {
  readonly sessions: SessionRepository;
  readonly users: UserRepository;
  readonly clock: Clock;
  readonly sessionLifetimeMs?: number;
}

export interface AuthenticateSessionCommand {
  readonly sessionId: SessionId;
}

export interface AuthenticatedSession {
  readonly user: User;
  readonly session: Session;
  /** True when this call pushed the expiry out, so a route can re-set the cookie. */
  readonly extended: boolean;
}

/**
 * UC12 — turn a session id into a user, or refuse.
 *
 * Called on every guarded request, so it is also the place a revocation takes
 * effect: sign-out and a credential change both write `revoked_at`, and the
 * very next request reads it. That is the whole argument for rows over JWTs
 * (§13) expressed in one lookup.
 */
export class AuthenticateSession {
  readonly #deps: AuthenticateSessionDependencies;

  constructor(dependencies: AuthenticateSessionDependencies) {
    this.#deps = dependencies;
  }

  async execute(
    command: AuthenticateSessionCommand,
  ): Promise<AuthenticatedSession> {
    const { sessions, users, clock } = this.#deps;

    const found = await sessions.findById(command.sessionId);
    if (found === null) {
      throw new SessionInvalidError('unknown');
    }

    // Revocation is checked before expiry so the reason is the deliberate
    // one when a session is both.
    if (found.isRevoked()) {
      throw new SessionInvalidError('revoked');
    }

    const now = clock.now();
    if (found.isExpired(now)) {
      throw new SessionInvalidError('expired');
    }

    const user = await users.findById(found.userId);
    if (user === null) {
      // The FK says this cannot happen. If it does, the session is the thing
      // that is wrong, and it is not a 500.
      throw new SessionInvalidError('unknown');
    }

    if (!found.isPastHalfLife(now)) {
      return { user, session: found, extended: false };
    }

    const extended = await sessions.update(
      found.extendedFrom(
        now,
        this.#deps.sessionLifetimeMs ?? SESSION_LIFETIME_MS,
      ),
    );

    return { user, session: extended, extended: true };
  }
}
