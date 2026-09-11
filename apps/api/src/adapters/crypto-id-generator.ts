import { randomBytes } from 'node:crypto';

import type { IdGenerator } from '@payout/core';

/**
 * 32 random bytes, base64url.
 *
 * The size is set by §5a's session id rather than by anything a document
 * needs: one generator, sized for the strictest caller, so nobody has to
 * remember which call site needed the unguessable one.
 */
export class CryptoIdGenerator implements IdGenerator {
  readonly #byteLength: number;

  constructor(byteLength = 32) {
    this.#byteLength = byteLength;
  }

  newId(): string {
    return randomBytes(this.#byteLength).toString('base64url');
  }
}
