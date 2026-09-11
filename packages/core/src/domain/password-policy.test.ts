import { describe, expect, it } from 'vitest';

import {
  MINIMUM_PASSWORD_LENGTH,
  checkPasswordPolicy,
  commonPasswords,
} from './password-policy';

const context = { username: 'admin', currentPassword: 'admin' };

describe('checkPasswordPolicy', () => {
  it('accepts a long password that is nothing else on the list', () => {
    expect(checkPasswordPolicy('quiet harbour lamp', context)).toEqual({
      ok: true,
      violations: [],
    });
  });

  describe('length', () => {
    it('rejects anything under twelve characters', () => {
      expect(checkPasswordPolicy('elevenchars', context).violations).toContain(
        'too_short',
      );
    });

    it('accepts exactly twelve', () => {
      const twelve = 'abcdefghijkl';

      expect(twelve).toHaveLength(MINIMUM_PASSWORD_LENGTH);
      expect(checkPasswordPolicy(twelve, context).ok).toBe(true);
    });

    it('counts characters, not bytes, and not words', () => {
      // Three words, eleven characters. Length is length.
      expect(checkPasswordPolicy('a bc def gh', context).violations).toContain(
        'too_short',
      );
    });

    it('has no composition rules — all lowercase letters is fine', () => {
      expect(checkPasswordPolicy('correcthorsebatterystaple', context)).toEqual(
        { ok: true, violations: [] },
      );
    });
  });

  describe('reuse of the current password', () => {
    it('rejects the current password even when it is long enough', () => {
      const result = checkPasswordPolicy('the old passphrase', {
        username: 'admin',
        currentPassword: 'the old passphrase',
      });

      expect(result.ok).toBe(false);
      expect(result.violations).toContain('same_as_current');
    });

    it('allows a password that differs only in case', () => {
      // A different string is a different password. Saying otherwise would
      // reveal that the two differ only in case.
      const result = checkPasswordPolicy('The Old Passphrase', {
        username: 'admin',
        currentPassword: 'the old passphrase',
      });

      expect(result.ok).toBe(true);
    });

    it('does not apply when there is no current password to compare', () => {
      expect(
        checkPasswordPolicy('some other phrase', { username: 'admin' }).ok,
      ).toBe(true);
    });
  });

  describe('the username', () => {
    it('rejects a password equal to the username', () => {
      const result = checkPasswordPolicy('administrator1', {
        username: 'administrator1',
      });

      expect(result.violations).toContain('same_as_username');
    });

    it('ignores case when comparing against the username', () => {
      const result = checkPasswordPolicy('AdMiNiStRaToR1', {
        username: 'administrator1',
      });

      expect(result.violations).toContain('same_as_username');
    });

    it('allows a password that merely contains the username', () => {
      // Rejecting containment would refuse 'admin' inside a long passphrase,
      // which is a real password and a bad thing to refuse.
      const result = checkPasswordPolicy('the admin of a quiet house', {
        username: 'admin',
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('the common list', () => {
    it('rejects a padded-out common password', () => {
      expect(
        checkPasswordPolicy('password1234', { username: 'admin' }).violations,
      ).toContain('too_common');
    });

    it('ignores case', () => {
      expect(
        checkPasswordPolicy('PassWord1234', { username: 'admin' }).violations,
      ).toContain('too_common');
    });

    it('every entry is long enough to actually be reachable', () => {
      // An entry shorter than the minimum could never be the only violation,
      // so it would be dead weight pretending to be a rule.
      for (const common of commonPasswords()) {
        expect(common.length).toBeGreaterThanOrEqual(MINIMUM_PASSWORD_LENGTH);
      }
    });

    it('is a short embedded list, not a corpus', () => {
      expect(commonPasswords().length).toBeLessThan(100);
    });
  });

  it('reports every violation rather than stopping at the first', () => {
    const result = checkPasswordPolicy('admin', {
      username: 'admin',
      currentPassword: 'admin',
    });

    expect(result.ok).toBe(false);
    expect([...result.violations].sort()).toEqual([
      'same_as_current',
      'same_as_username',
      'too_short',
    ]);
  });

  it('rejects the shipped default, which is the point of the flag', () => {
    expect(
      checkPasswordPolicy('admin', {
        username: 'admin',
        currentPassword: 'admin',
      }).ok,
    ).toBe(false);
  });
});
