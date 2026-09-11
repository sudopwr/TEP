import {
  AuthenticationFailedError,
  InvalidUsernameError,
  PasswordPolicyError,
  UserNotFoundError,
  UsernameTakenError,
} from '../domain/errors';
import type { SessionId, UserId } from '../domain/ids';
import { checkPasswordPolicy } from '../domain/password-policy';
import type { User } from '../domain/user';
import type { Clock } from '../ports/clock';
import type { PasswordHasher } from '../ports/password-hasher';
import type { SessionRepository } from '../ports/session-repository';
import type { UserRepository } from '../ports/user-repository';

export interface ChangeCredentialsDependencies {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly hasher: PasswordHasher;
  readonly clock: Clock;
}

export interface ChangeCredentialsCommand {
  readonly userId: UserId;
  readonly currentPassword: string;
  readonly newUsername?: string;
  readonly newPassword?: string;
  /** Spared from the revocation sweep — the caller is still using it. */
  readonly currentSessionId?: SessionId;
}

export interface ChangeCredentialsResult {
  readonly user: User;
  readonly passwordChanged: boolean;
  readonly usernameChanged: boolean;
  /** How many other sessions were revoked. */
  readonly sessionsRevoked: number;
}

/**
 * Short enough to fit a column and a screen. There is no lower bound beyond
 * "not empty": §5a specifies a *password* policy and says nothing about
 * usernames, and on a single-user local app `kd` is a perfectly good name.
 * A minimum length here would be a rule invented to look strict.
 */
const USERNAME_MAX = 64;

/**
 * UC13 — change the username, the password, or both.
 *
 * The order matters. The current password is verified first, before anything
 * is validated and long before anything is written, so this cannot be used as
 * an oracle for whether a username is taken.
 *
 * The policy is checked against the *new* username when one is supplied:
 * setting your username and password to the same string in a single call
 * would otherwise slip past a check that looked at the old name.
 */
export class ChangeCredentials {
  readonly #deps: ChangeCredentialsDependencies;

  constructor(dependencies: ChangeCredentialsDependencies) {
    this.#deps = dependencies;
  }

  async execute(
    command: ChangeCredentialsCommand,
  ): Promise<ChangeCredentialsResult> {
    const { users, sessions, hasher, clock } = this.#deps;

    const user = await users.findById(command.userId);
    if (user === null) {
      throw new UserNotFoundError(command.userId);
    }

    const correct = await hasher.verify(
      user.passwordHash,
      command.currentPassword,
    );
    if (!correct) {
      throw new AuthenticationFailedError('wrong_password');
    }

    const username =
      command.newUsername === undefined
        ? user.username
        : this.#validUsername(command.newUsername);

    const usernameChanged = username !== user.username;

    if (usernameChanged) {
      const clash = await users.findByUsername(username);
      if (clash !== null && clash.id !== user.id) {
        throw new UsernameTakenError(username);
      }
    }

    const passwordChanged = command.newPassword !== undefined;

    if (!passwordChanged && !usernameChanged) {
      return {
        user,
        passwordChanged: false,
        usernameChanged: false,
        sessionsRevoked: 0,
      };
    }

    const now = clock.now();
    let updated = usernameChanged ? user.withUsername(username) : user;

    if (command.newPassword !== undefined) {
      const verdict = checkPasswordPolicy(command.newPassword, {
        username,
        currentPassword: command.currentPassword,
      });

      if (!verdict.ok) {
        throw new PasswordPolicyError(verdict.violations);
      }

      updated = updated.withPassword(
        await hasher.hash(command.newPassword),
        now.toISOString(),
      );
    }

    const saved = await users.update(updated);

    // §5a: "Changing credentials revokes every other session." The reason
    // anyone changes a password is that they think it leaked (§13), so the
    // sweep covers a username-only change too — the attacker's session is
    // just as unwelcome either way.
    const sessionsRevoked = await sessions.revokeAllForUser(
      saved.id,
      now.toISOString(),
      command.currentSessionId,
    );

    return { user: saved, passwordChanged, usernameChanged, sessionsRevoked };
  }

  #validUsername(candidate: string): string {
    const username = candidate.trim();

    if (username.length === 0) {
      throw new InvalidUsernameError(username, 'a username cannot be empty');
    }

    if (username.length > USERNAME_MAX) {
      throw new InvalidUsernameError(
        username,
        `a username may not exceed ${String(USERNAME_MAX)} characters`,
      );
    }

    if (/\s/.test(username)) {
      throw new InvalidUsernameError(
        username,
        'a username may not contain whitespace',
      );
    }

    return username;
  }
}
