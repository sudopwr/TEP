/**
 * The password policy, as a pure function (CLAUDE.md §5a).
 *
 * No I/O, no clock, no repository — a candidate, a context, and a verdict.
 * That is what makes it cheap to test exhaustively and impossible to bypass
 * by calling a different code path: UC13 is the only writer of a password
 * hash, and it calls this first.
 *
 * Length only. No composition rules, deliberately: forcing a symbol and a
 * digit pushes people to `Password1!`, which is twelve characters of nothing.
 */

/** The one number in the policy. §5a: "Minimum 12 characters." */
export const MINIMUM_PASSWORD_LENGTH = 12;

export type PasswordPolicyViolation =
  'too_short' | 'same_as_current' | 'same_as_username' | 'too_common';

/**
 * A short embedded list, not a leaked-password corpus.
 *
 * Every entry here is at least `MINIMUM_PASSWORD_LENGTH` characters, which is
 * the only length that can reach this check — anything shorter is already
 * rejected as `too_short`. A twelve-character rule quietly kills `password`
 * and `qwerty`; what it does not kill is somebody padding one out to reach
 * the limit, which is exactly what this list is for.
 *
 * Compared case-insensitively, so `Password1234` is caught too.
 */
const COMMON_PASSWORDS: readonly string[] = [
  '123456789012',
  '1234567890123',
  '123456789abc',
  '1qaz2wsx3edc',
  'abcd1234abcd',
  'administrator',
  'adminadmin12',
  'baseball12345',
  'changeme1234',
  'football12345',
  'iloveyou1234',
  'letmein12345',
  'monkey123456',
  'password1234',
  'password12345',
  'passwordpassword',
  'princess12345',
  'qwerty123456',
  'qwertyuiop123',
  'secretsecret',
  'sunshine12345',
  'superman12345',
  'trustno1234567',
  'welcome123456',
  'zaq12wsxcde3',
];

export interface PasswordPolicyContext {
  /** The username the password will belong to — the new one, if it changes. */
  readonly username: string;
  /** The password being replaced, so reuse can be refused. */
  readonly currentPassword?: string;
}

export interface PasswordPolicyResult {
  readonly ok: boolean;
  /** Every rule the candidate broke, in a stable order. Empty when `ok`. */
  readonly violations: readonly PasswordPolicyViolation[];
}

/** Case-insensitive equality, used for the username and the common list. */
function sameIgnoringCase(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Check a candidate password. Reports *every* violation, not the first.
 *
 * Returning the whole list matters at the change-password screen: telling
 * somebody their password is too short, watching them fix that, and only then
 * telling them it is also their username is how a person ends up on their
 * fourth attempt.
 *
 * The current password is compared exactly, not case-insensitively — a
 * one-character case change is a different password, if a poor one, and
 * claiming otherwise would leak that the two differ only in case.
 */
export function checkPasswordPolicy(
  candidate: string,
  context: PasswordPolicyContext,
): PasswordPolicyResult {
  const violations: PasswordPolicyViolation[] = [];

  if (candidate.length < MINIMUM_PASSWORD_LENGTH) {
    violations.push('too_short');
  }

  if (
    context.currentPassword !== undefined &&
    candidate === context.currentPassword
  ) {
    violations.push('same_as_current');
  }

  if (sameIgnoringCase(candidate, context.username)) {
    violations.push('same_as_username');
  }

  if (COMMON_PASSWORDS.some((common) => sameIgnoringCase(candidate, common))) {
    violations.push('too_common');
  }

  return { ok: violations.length === 0, violations };
}

/** The list, for a test that wants to prove the length claim above. */
export function commonPasswords(): readonly string[] {
  return COMMON_PASSWORDS;
}
