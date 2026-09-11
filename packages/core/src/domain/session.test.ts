import { describe, expect, it } from 'vitest';

import { SESSION_LIFETIME_MS, Session } from './session';

const START = new Date('2025-03-16T10:30:00.000Z');

const fresh = () => Session.starting('sess-1', 7, START);

describe('Session', () => {
  describe('starting', () => {
    it('runs for thirty days from now', () => {
      const session = fresh();

      expect(session.createdAt).toBe('2025-03-16T10:30:00.000Z');
      expect(session.expiresAt).toBe('2025-04-15T10:30:00.000Z');
      expect(SESSION_LIFETIME_MS).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('starts unrevoked and active', () => {
      expect(fresh().revokedAt).toBeNull();
      expect(fresh().isActive(START)).toBe(true);
    });
  });

  describe('expiry', () => {
    it('is alive a millisecond before it expires', () => {
      const justBefore = new Date(START.getTime() + SESSION_LIFETIME_MS - 1);

      expect(fresh().isExpired(justBefore)).toBe(false);
    });

    it('is dead exactly at its expiry, not a moment after', () => {
      const exactly = new Date(START.getTime() + SESSION_LIFETIME_MS);

      expect(fresh().isExpired(exactly)).toBe(true);
      expect(fresh().isActive(exactly)).toBe(false);
    });
  });

  describe('revocation', () => {
    it('stamps the moment and stops being active', () => {
      const revoked = fresh().revoked(START);

      expect(revoked.isRevoked()).toBe(true);
      expect(revoked.revokedAt).toBe('2025-03-16T10:30:00.000Z');
      expect(revoked.isActive(START)).toBe(false);
    });

    it('is idempotent — a second revoke keeps the first stamp', () => {
      const once = fresh().revoked(START);
      const twice = once.revoked(new Date('2025-03-20T00:00:00.000Z'));

      expect(twice.revokedAt).toBe('2025-03-16T10:30:00.000Z');
      expect(twice).toBe(once);
    });

    it('does not resurrect when the clock is still inside the window', () => {
      expect(fresh().revoked(START).isActive(START)).toBe(false);
    });
  });

  describe('the halfway mark', () => {
    it('is not past it on day one', () => {
      expect(fresh().isPastHalfLife(START)).toBe(false);
    });

    it('is not past it a moment before the midpoint', () => {
      const almost = new Date(START.getTime() + SESSION_LIFETIME_MS / 2 - 1);

      expect(fresh().isPastHalfLife(almost)).toBe(false);
    });

    it('is past it at the midpoint', () => {
      const midpoint = new Date(START.getTime() + SESSION_LIFETIME_MS / 2);

      expect(fresh().isPastHalfLife(midpoint)).toBe(true);
    });

    it('measures from created-at, so an extended session is young again', () => {
      const later = new Date(START.getTime() + SESSION_LIFETIME_MS / 2);
      const extended = fresh().extendedFrom(later);

      // Created 15 days ago, now expiring in 30: 15 of 45 elapsed.
      expect(extended.isPastHalfLife(later)).toBe(false);
    });
  });

  describe('extendedFrom', () => {
    it('moves the expiry and not the creation stamp', () => {
      const later = new Date('2025-04-01T10:30:00.000Z');
      const extended = fresh().extendedFrom(later);

      expect(extended.createdAt).toBe('2025-03-16T10:30:00.000Z');
      expect(extended.expiresAt).toBe('2025-05-01T10:30:00.000Z');
    });

    it('keeps the same id, so the cookie stays valid', () => {
      expect(fresh().extendedFrom(START).id).toBe('sess-1');
    });
  });

  it('keeps the id out of toJSON — it is a bearer secret', () => {
    expect(JSON.stringify(fresh())).not.toContain('sess-1');
  });

  it('is frozen', () => {
    const session = fresh();

    expect(() => {
      (session as unknown as { expiresAt: string }).expiresAt = 'whenever';
    }).toThrow();
  });
});
