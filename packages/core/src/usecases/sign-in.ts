import { AuthenticationFailedError } from '../domain/errors';
import { SESSION_LIFETIME_MS, Session } from '../domain/session';
import type { User } from '../domain/user';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/id-generator';
import type { PasswordHasher } from '../ports/password-hasher';
import type { SessionRepository } from '../ports/session-repository';
import type { UserRepository } from '../ports/user-repository';

export interface SignInDependencies {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly hasher: PasswordHasher;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** Overridable so a test can expire a session without waiting a month. */
  readonly sessionLifetimeMs?: number;
}

export interface SignInCommand {
  readonly username: string;
  readonly password: string;
}

export interface SignInResult {
  readonly session: Session;
  readonly user: User;
  /** Hoisted out of `user` because it is the only thing the UI branches on. */
  readonly mustChangePassword: boolean;
}

/**
 * UC11 — verify a credential and open a session.
 *
 * Two things here are not ordinary application code and must not be
 * "simplified" later:
 *
 * 1. An unknown username still runs a full argon2 verification, against a
 *    hash of something nobody knows. Without it, an unknown username returns
 *    in microseconds and a wrong password takes ~50ms, and the response time
 *    answers the question the error message is refusing to answer.
 *
 * 2. Both failures throw the same error with the same message. The `cause`
 *    field exists for the server's own log, and is never rendered.
 */
export class SignIn {
  readonly #deps: SignInDependencies;

  constructor(dependencies: SignInDependencies) {
    this.#deps = dependencies;
  }

  async execute(command: SignInCommand): Promise<SignInResult> {
    const { users, sessions, hasher, ids, clock } = this.#deps;

    const user = await users.findByUsername(command.username);

    if (user === null) {
      // Not a shortcut we can take: see (1) above.
      await hasher.verify(await hasher.dummyHash(), command.password);
      throw new AuthenticationFailedError('unknown_username');
    }

    const correct = await hasher.verify(user.passwordHash, command.password);
    if (!correct) {
      throw new AuthenticationFailedError('wrong_password');
    }

    const now = clock.now();

    // §5a: the encoded hash carries its own parameters, so raising the cost
    // is a rehash at the one moment the plaintext is in hand — right here.
    const current = hasher.needsRehash(user.passwordHash)
      ? await users.update(
          user.withRehashedPassword(await hasher.hash(command.password)),
        )
      : user;

    const session = await sessions.insert(
      Session.starting(
        ids.newId(),
        current.id,
        now,
        this.#deps.sessionLifetimeMs ?? SESSION_LIFETIME_MS,
      ),
    );

    return {
      session,
      user: current,
      mustChangePassword: current.mustChangePassword,
    };
  }
}
