/**
 * Password hashing, kept outside core (§5a, §13).
 *
 * Core sees a string going in and a boolean coming out. argon2id, its memory
 * cost, its salt and its encoded format are all infrastructure concerns that
 * live in `apps/api/src/auth`. That is not only the dependency rule: it is
 * what makes the cost parameter raisable without touching a use case.
 *
 * Nothing here takes or returns a plaintext password anywhere it could be
 * stored. `hash` consumes one and forgets it; `verify` compares and forgets.
 */
export interface PasswordHasher {
  /** The full encoded string — algorithm, version, parameters, salt, tag. */
  hash(plaintext: string): Promise<string>;

  /**
   * Constant-time as far as the algorithm allows. Returns false rather than
   * throwing on a malformed stored hash: a corrupt row is a failed sign-in,
   * not a 500 that tells an attacker something interesting.
   */
  verify(encoded: string, plaintext: string): Promise<boolean>;

  /**
   * True when `encoded` was produced with weaker parameters than current.
   *
   * §5a: raising the cost later is a rehash on next login, because the
   * parameters travel inside the encoded string. UC11 asks this question
   * once per successful sign-in, which is the only moment the plaintext is
   * available to rehash with.
   */
  needsRehash(encoded: string): boolean;

  /**
   * A real hash of a password nobody knows, for the unknown-username path.
   *
   * UC11 must do the same amount of work whether or not the username exists,
   * or the response time answers a question the error message refuses to.
   * Core decides that this comparison happens; the adapter supplies something
   * expensive enough for it to mean anything.
   */
  dummyHash(): Promise<string>;
}
