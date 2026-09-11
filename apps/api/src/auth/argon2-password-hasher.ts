import { hash, hashSync, verify } from '@node-rs/argon2';

import type { PasswordHasher } from '@payout/core';

/**
 * argon2id, at the library's recommended parameters (CLAUDE.md §5a).
 *
 * These are `@node-rs/argon2`'s own defaults, restated explicitly rather than
 * left implicit: the numbers have to be legible here to be compared against
 * the ones inside a stored hash, which is what `needsRehash` does. They match
 * OWASP's current argon2id guidance — 19 MiB, two passes, one lane.
 *
 * Raising any of them is a one-line change. Every existing credential is then
 * re-hashed at its owner's next sign-in (UC11), because the parameters that
 * produced a hash travel inside the encoded string.
 *
 * `algorithm: 2` rather than `Algorithm.Argon2id`: the library declares that
 * enum as an ambient `const enum`, which has no runtime value and which
 * `verbatimModuleSyntax` (tsconfig.base.json) refuses to inline. The literal
 * is pinned by a test asserting the produced hash begins `$argon2id$`, so a
 * library renumbering cannot slip past silently.
 */
export const ARGON2_PARAMETERS = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<tag>` */
const ENCODED =
  /^\$argon2(?<variant>[a-z]+)\$v=(?<version>\d+)\$m=(?<m>\d+),t=(?<t>\d+),p=(?<p>\d+)\$/;

/**
 * The one place in the application that knows what a password hash is.
 *
 * Core never sees argon2, a salt, or a cost parameter — §5a and §13 put
 * hashing in `apps/api/auth` precisely so that raising the cost, or one day
 * replacing the algorithm, touches this file and nothing else.
 */
export class Argon2PasswordHasher implements PasswordHasher {
  /**
   * Memoised, because the whole point is that it is expensive.
   *
   * Computing it on the first unknown username would make that one request
   * slower than every subsequent one — a timing tell in the very code meant
   * to remove one. `warmUp()` at boot pays for it before anyone can measure.
   */
  #dummy: Promise<string> | null = null;

  hash(plaintext: string): Promise<string> {
    return hash(plaintext, ARGON2_PARAMETERS);
  }

  async verify(encoded: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(encoded, plaintext, ARGON2_PARAMETERS);
    } catch {
      // A malformed or truncated stored hash is a failed sign-in, not a 500.
      // Throwing here would let a corrupt row answer a question the generic
      // error message is refusing to answer.
      return false;
    }
  }

  /**
   * True when the stored hash was produced with weaker parameters.
   *
   * Weaker, not merely different: someone who lowers the cost on purpose (to
   * run a test suite, say) should not have every credential silently upgraded
   * back. An unparseable or non-argon2id hash always wants rehashing.
   */
  needsRehash(encoded: string): boolean {
    const groups = ENCODED.exec(encoded)?.groups;
    if (groups === undefined) {
      return true;
    }

    if (groups['variant'] !== 'id') {
      return true;
    }

    return (
      Number(groups['m']) < ARGON2_PARAMETERS.memoryCost ||
      Number(groups['t']) < ARGON2_PARAMETERS.timeCost ||
      Number(groups['p']) < ARGON2_PARAMETERS.parallelism
    );
  }

  dummyHash(): Promise<string> {
    this.#dummy ??= hash(
      // Not a password, and deliberately not a constant: nothing that reaches
      // this hash is ever compared successfully, and a per-process value means
      // a stolen database reveals nothing about the dummy either.
      `unknown-user-${String(Math.random())}-${String(Date.now())}`,
      ARGON2_PARAMETERS,
    );

    return this.#dummy;
  }

  /** Pay for the dummy hash at boot rather than on somebody's first request. */
  async warmUp(): Promise<void> {
    await this.dummyHash();
  }
}

/**
 * The synchronous path, for migration seeding only.
 *
 * better-sqlite3 transactions are synchronous, so a seed that runs inside a
 * migration's transaction cannot await. This is the one caller that needs
 * that; everything serving a request uses the async methods above, which run
 * argon2 on the thread pool instead of blocking the event loop.
 */
export function hashPasswordSync(plaintext: string): string {
  return hashSync(plaintext, ARGON2_PARAMETERS);
}
