import type { IdGenerator } from '../../src/ports/id-generator';

/**
 * Predictable ids: `id-1`, `id-2`, ...
 *
 * Real randomness makes a test assert "something was generated" instead of
 * "this exact value was used", which is the weaker assertion.
 */
export class FakeIdGenerator implements IdGenerator {
  #next = 1;
  readonly #prefix: string;

  constructor(prefix = 'id') {
    this.#prefix = prefix;
  }

  newId(): string {
    const id = `${this.#prefix}-${this.#next}`;
    this.#next += 1;
    return id;
  }

  /** Everything handed out so far, oldest first. */
  issued(): readonly string[] {
    return Array.from(
      { length: this.#next - 1 },
      (_unused, index) => `${this.#prefix}-${index + 1}`,
    );
  }
}
