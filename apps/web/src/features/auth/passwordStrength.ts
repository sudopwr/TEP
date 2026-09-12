import {
  MINIMUM_PASSWORD_LENGTH,
  checkPasswordPolicy,
  type PasswordPolicyViolation,
} from '@payout/core';

import type { PasswordStrength } from '../../shared/components';

/**
 * The policy, run in the browser — the same function the server runs.
 *
 * Imported from `@payout/core`, not reimplemented. §5a puts the policy in
 * `core/domain/password-policy.ts` as a pure function precisely so there is
 * one copy of it; a second implementation here would be a second answer to
 * "is this password acceptable", and the two would disagree the first time
 * either changed.
 *
 * This is feedback, not enforcement. The server checks again on every
 * `/auth/change-credentials` and is the only thing that can actually refuse —
 * which is why `describeViolation` also handles codes that arrive from the
 * server without ever having been produced here.
 */

export interface PasswordAssessment {
  readonly ok: boolean;
  readonly violations: readonly PasswordPolicyViolation[];
  /** What to tell the reader, one sentence per violation. */
  readonly problems: readonly string[];
  readonly strength: PasswordStrength;
}

/**
 * A sentence per rule, each saying what to do rather than what is wrong.
 *
 * "Password rejected by policy: too_short" is the server's own message, and
 * it is written for a log. This is written for the person typing.
 */
export function describeViolation(violation: string): string {
  switch (violation) {
    case 'too_short':
      return `Use at least ${String(MINIMUM_PASSWORD_LENGTH)} characters — length is the whole policy, so there are no other rules to satisfy.`;
    case 'same_as_current':
      return 'Choose something other than the password you are replacing.';
    case 'same_as_username':
      return 'Choose something other than your username.';
    case 'too_common':
      return 'That is on the list of passwords guessed first. Choose something else.';
    default:
      // A violation this build does not know about still has to render as a
      // sentence, because the server is the one that refuses.
      return `The server rejected this password (${violation}).`;
  }
}

/**
 * A score out of four, and the words beside the bar.
 *
 * Deliberately crude. This is not an entropy estimate and must not look like
 * one: a meter that reads "strong" for `Tr0ub4dor&3` teaches the wrong lesson,
 * and one that reads "weak" for a fine four-word passphrase gets ignored.
 * Below the policy is 1, at the policy is 3, and comfortably past it is 4 —
 * which is the only distinction the reader can act on.
 */
export function assessPassword(
  candidate: string,
  context: { readonly username: string; readonly currentPassword?: string },
): PasswordAssessment {
  if (candidate === '') {
    return {
      ok: false,
      violations: [],
      problems: [],
      strength: { score: 0 },
    };
  }

  const result = checkPasswordPolicy(candidate, context);

  if (!result.ok) {
    return {
      ok: false,
      violations: result.violations,
      problems: result.violations.map(describeViolation),
      strength: { score: 1, label: 'Not accepted yet' },
    };
  }

  const score = candidate.length >= MINIMUM_PASSWORD_LENGTH + 8 ? 4 : 3;

  return {
    ok: true,
    violations: [],
    problems: [],
    strength: {
      score,
      label: score === 4 ? 'Good length' : 'Meets the policy',
    },
  };
}
