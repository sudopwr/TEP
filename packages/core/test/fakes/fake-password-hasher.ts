import { createHash } from 'node:crypto';

import type { PasswordHasher } from '../../src/ports/password-hasher';

/**
 * A real hasher, in the sense that matters here: a deterministic function
 * from plaintext to an encoded string that only the matching plaintext
 * verifies against. Not a mock — nothing records calls, nothing is stubbed.
 *
 * It is emphatically NOT a password hash. There is no salt and no work
 * factor, because a use-case test should not spend 50ms per assertion
 * proving argon2 is slow. Whether the real hashing is sound is settled in
 * `apps/api/src/auth/argon2-password-hasher.test.ts` against the real
 * library, and the contract run exercises these same use cases against it.
 */
export class FakePasswordHasher implements PasswordHasher {
  /** Encoded hashes not carrying this cost are treated as stale. */
  #cost: number;
  /** Counted so a test can prove the unknown-username path still verifies. */
  verifications = 0;

  constructor(cost = 2) {
    this.#cost = cost;
  }

  /** The same function `hash` uses, for seeding a world without awaiting. */
  static encode(plaintext: string, cost = 2): string {
    const digest = createHash('sha256')
      .update(`${String(cost)}:${plaintext}`, 'utf8')
      .digest('hex');
    return `$fake$c=${String(cost)}$${digest}`;
  }

  hash(plaintext: string): Promise<string> {
    return Promise.resolve(FakePasswordHasher.encode(plaintext, this.#cost));
  }

  verify(encoded: string, plaintext: string): Promise<boolean> {
    this.verifications += 1;

    const cost = FakePasswordHasher.#costOf(encoded);
    if (cost === null) {
      return Promise.resolve(false);
    }

    return Promise.resolve(
      FakePasswordHasher.encode(plaintext, cost) === encoded,
    );
  }

  needsRehash(encoded: string): boolean {
    return FakePasswordHasher.#costOf(encoded) !== this.#cost;
  }

  dummyHash(): Promise<string> {
    return Promise.resolve(FakePasswordHasher.encode('  nobody knows'));
  }

  /** Raise the cost, so a test can watch a login rehash an old credential. */
  raiseCost(cost: number): void {
    this.#cost = cost;
  }

  static #costOf(encoded: string): number | null {
    const match = /^[$]fake[$]c=(\d+)[$][0-9a-f]{64}$/.exec(encoded);
    return match?.[1] === undefined ? null : Number(match[1]);
  }
}
