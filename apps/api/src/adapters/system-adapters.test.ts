import { describe, expect, it } from 'vitest';

import { CryptoIdGenerator } from './crypto-id-generator';
import { SystemClock } from './system-clock';

describe('SystemClock', () => {
  const clock = new SystemClock();

  it('reports a time close to now', () => {
    const drift = Math.abs(clock.now().getTime() - Date.now());

    expect(drift).toBeLessThan(1000);
  });

  it('formats today as YYYY-MM-DD', () => {
    expect(clock.today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('answers with the local date, not the UTC one', () => {
    // Late evening in Kolkata is already tomorrow in UTC. Using UTC would put
    // a 31 March payout into the wrong financial year.
    const now = clock.now();
    const local = [
      String(now.getFullYear()).padStart(4, '0'),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');

    expect(clock.today()).toBe(local);
  });

  it('hands out a new Date each call, not a shared one', () => {
    const first = clock.now();
    first.setFullYear(1999);

    expect(clock.now().getFullYear()).not.toBe(1999);
  });
});

describe('CryptoIdGenerator', () => {
  it('produces url-safe ids', () => {
    expect(new CryptoIdGenerator().newId()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces 32 bytes by default, as §5a requires of a session id', () => {
    // 32 bytes of base64url is 43 characters with no padding.
    expect(new CryptoIdGenerator().newId()).toHaveLength(43);
  });

  it('does not repeat itself', () => {
    const generator = new CryptoIdGenerator();
    const ids = new Set(Array.from({ length: 500 }, () => generator.newId()));

    expect(ids.size).toBe(500);
  });

  it('honours a different length', () => {
    expect(new CryptoIdGenerator(8).newId()).toHaveLength(11);
  });
});
