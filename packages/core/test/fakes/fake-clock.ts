import type { IsoDate } from '../../src/domain/ids';
import type { Clock } from '../../src/ports/clock';

/**
 * A clock that does not move unless you move it.
 *
 * Every use case that stamps a time takes this, so a test can assert on the
 * stamp instead of asserting that it is "roughly now".
 */
export class FakeClock implements Clock {
  #instant: Date;

  constructor(iso = '2025-03-16T10:30:00.000Z') {
    this.#instant = new Date(iso);
  }

  now(): Date {
    return new Date(this.#instant.getTime());
  }

  today(): IsoDate {
    const iso = this.#instant.toISOString();
    return iso.slice(0, 10);
  }

  /** Move the clock to an exact instant. */
  set(iso: string): void {
    this.#instant = new Date(iso);
  }

  /** Move the clock forward by a whole number of seconds. */
  advanceSeconds(seconds: number): void {
    this.#instant = new Date(this.#instant.getTime() + seconds * 1000);
  }
}
