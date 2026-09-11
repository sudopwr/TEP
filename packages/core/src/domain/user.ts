import type { IsoInstant, UserId } from './ids';

export interface UserProps {
  readonly id: UserId;
  readonly username: string;
  /**
   * The full argon2id encoded string — algorithm, version, parameters, salt
   * and tag in one field (§5a). Never a bare digest, never a salt we chose.
   * Keeping the parameters inside the value is what makes raising the cost a
   * rehash on next login rather than a migration.
   */
  readonly passwordHash: string;
  readonly mustChangePassword: boolean;
  readonly createdAt: IsoInstant;
  readonly passwordChangedAt: IsoInstant | null;
}

/**
 * The one account (§5a). Immutable; changes return a copy.
 *
 * There is no registration flow and no second user, so this entity exists to
 * hold a credential and a flag rather than to model people.
 */
export class User {
  readonly #props: UserProps;

  private constructor(props: UserProps) {
    this.#props = Object.freeze({ ...props });
  }

  static create(props: UserProps): User {
    return new User(props);
  }

  get id(): UserId {
    return this.#props.id;
  }

  get username(): string {
    return this.#props.username;
  }

  get passwordHash(): string {
    return this.#props.passwordHash;
  }

  get mustChangePassword(): boolean {
    return this.#props.mustChangePassword;
  }

  get createdAt(): IsoInstant {
    return this.#props.createdAt;
  }

  get passwordChangedAt(): IsoInstant | null {
    return this.#props.passwordChangedAt;
  }

  /**
   * A new password, and with it the end of the must-change cage.
   *
   * Setting a password is the *only* thing that clears the flag. Renaming
   * does not, and neither does anything else — otherwise §5a's "no route past
   * the change screen" would have a route past it: change your username,
   * clear the flag, carry on using `admin` as your password.
   */
  withPassword(passwordHash: string, changedAt: IsoInstant): User {
    return new User({
      ...this.#props,
      passwordHash,
      mustChangePassword: false,
      passwordChangedAt: changedAt,
    });
  }

  /**
   * The same password, re-encoded under stronger parameters.
   *
   * Deliberately NOT `withPassword`: the credential has not changed, only
   * the cost it is stored at, so the must-change flag stays exactly as it
   * was and `passwordChangedAt` does not move. Signing in as `admin` must
   * not open the cage just because the hashing got more expensive.
   */
  withRehashedPassword(passwordHash: string): User {
    return new User({ ...this.#props, passwordHash });
  }

  withUsername(username: string): User {
    return new User({ ...this.#props, username });
  }

  equals(other: User): boolean {
    return this.#props.id === other.id;
  }

  /**
   * Serialising a user must not serialise the credential.
   *
   * N9 says the plaintext never reaches disk, a log, or an error message. The
   * hash is not the plaintext, but it is the thing an offline attack needs,
   * and `reply.send(user)` is one careless keystroke away in every route. The
   * safe default belongs on the entity, not in a reviewer's memory.
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.#props.id,
      username: this.#props.username,
      mustChangePassword: this.#props.mustChangePassword,
      createdAt: this.#props.createdAt,
      passwordChangedAt: this.#props.passwordChangedAt,
    };
  }
}
