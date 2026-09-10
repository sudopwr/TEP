import type { IsoDate } from '../domain/ids';

/**
 * The current time, as something a test can pin.
 *
 * Nothing in core calls `new Date()` directly: a use case that stamps a
 * `created_at` or decides whether a session has expired must be testable
 * without waiting, and a frozen clock is the only way to assert on it.
 */
export interface Clock {
  /** The current instant. */
  now(): Date;

  /** Today as `YYYY-MM-DD`, in whatever zone the adapter considers local. */
  today(): IsoDate;
}
