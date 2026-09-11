import type { SessionId } from '../domain/ids';
import type { Clock } from '../ports/clock';
import type { SessionRepository } from '../ports/session-repository';

export interface SignOutDependencies {
  readonly sessions: SessionRepository;
  readonly clock: Clock;
}

export interface SignOutCommand {
  readonly sessionId: SessionId;
}

export interface SignOutResult {
  /** False when there was nothing live to revoke. Not an error either way. */
  readonly revoked: boolean;
}

/**
 * UC14 — revoke a session, server-side.
 *
 * Idempotent, and deliberately silent about what it found. Signing out twice,
 * signing out with an expired cookie, and signing out with a session id that
 * was never issued all do the same thing and say the same thing: a sign-out
 * endpoint that distinguished them would be a free session-id oracle on an
 * unauthenticated route.
 */
export class SignOut {
  readonly #deps: SignOutDependencies;

  constructor(dependencies: SignOutDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: SignOutCommand): Promise<SignOutResult> {
    const { sessions, clock } = this.#deps;

    const session = await sessions.findById(command.sessionId);
    if (session === null || session.isRevoked()) {
      return { revoked: false };
    }

    await sessions.update(session.revoked(clock.now()));
    return { revoked: true };
  }
}
