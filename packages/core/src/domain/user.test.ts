import { describe, expect, it } from 'vitest';

import { User } from './user';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$abcdefghijklmnop';
const NEW_HASH = '$argon2id$v=19$m=19456,t=2,p=1$b3RoZXJzYWx0$qrstuvwxyz012345';

const admin = () =>
  User.create({
    id: 1,
    username: 'admin',
    passwordHash: HASH,
    mustChangePassword: true,
    createdAt: '2025-03-01T00:00:00.000Z',
    passwordChangedAt: null,
  });

describe('User', () => {
  it('carries the encoded hash, parameters and all', () => {
    expect(admin().passwordHash).toBe(HASH);
    expect(admin().passwordHash).toContain('m=19456,t=2,p=1');
  });

  describe('withPassword', () => {
    it('returns a new instance and leaves the original alone', () => {
      const original = admin();
      const changed = original.withPassword(
        NEW_HASH,
        '2025-03-16T10:30:00.000Z',
      );

      expect(changed).not.toBe(original);
      expect(original.passwordHash).toBe(HASH);
      expect(changed.passwordHash).toBe(NEW_HASH);
    });

    it('clears the must-change flag and stamps the change', () => {
      const changed = admin().withPassword(
        NEW_HASH,
        '2025-03-16T10:30:00.000Z',
      );

      expect(changed.mustChangePassword).toBe(false);
      expect(changed.passwordChangedAt).toBe('2025-03-16T10:30:00.000Z');
    });
  });

  describe('withUsername', () => {
    it('renames without touching the credential', () => {
      const renamed = admin().withUsername('kd');

      expect(renamed.username).toBe('kd');
      expect(renamed.passwordHash).toBe(HASH);
    });

    it('does NOT clear the must-change flag', () => {
      // The cage in §5a has no door marked "rename". If a username change
      // cleared the flag, the shipped `admin` password would survive it.
      expect(admin().withUsername('kd').mustChangePassword).toBe(true);
    });
  });

  it('identifies by id, not by field values', () => {
    expect(admin().withUsername('kd').equals(admin())).toBe(true);
  });

  it('is frozen — no reaching in to swap the hash', () => {
    const user = admin();

    expect(() => {
      (user as unknown as { passwordHash: string }).passwordHash = NEW_HASH;
    }).toThrow();
  });

  describe('serialisation', () => {
    it('leaves the hash out of toJSON', () => {
      // N9. One careless `reply.send(user)` is all it takes, so the safe
      // default lives on the entity rather than in a reviewer's memory.
      const serialised = JSON.stringify(admin());

      expect(serialised).not.toContain(HASH);
      expect(serialised).not.toContain('passwordHash');
    });

    it('still carries what a route actually needs', () => {
      expect(admin().toJSON()).toMatchObject({
        id: 1,
        username: 'admin',
        mustChangePassword: true,
      });
    });
  });
});

describe('User.withRehashedPassword', () => {
  it('swaps the encoding without touching the flag or the stamp', () => {
    // A rehash is not a password change. Signing in as the shipped admin on
    // a day the cost parameter went up must not unlock the app.
    const rehashed = admin().withRehashedPassword(NEW_HASH);

    expect(rehashed.passwordHash).toBe(NEW_HASH);
    expect(rehashed.mustChangePassword).toBe(true);
    expect(rehashed.passwordChangedAt).toBeNull();
  });

  it('keeps a real change stamp when one is already there', () => {
    const changed = admin().withPassword(NEW_HASH, '2025-03-16T10:30:00.000Z');

    expect(changed.withRehashedPassword(HASH).passwordChangedAt).toBe(
      '2025-03-16T10:30:00.000Z',
    );
  });
});
