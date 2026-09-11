import type { Clock, IsoDate } from '@payout/core';

/**
 * The real clock.
 *
 * `today()` is deliberately local-time rather than UTC: a payout recorded at
 * 9pm in Kolkata belongs to that day, and answering "2025-03-17" because UTC
 * has already rolled over would put it in the wrong financial year on the
 * last day of March.
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  today(): IsoDate {
    const now = this.now();
    const year = String(now.getFullYear()).padStart(4, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
