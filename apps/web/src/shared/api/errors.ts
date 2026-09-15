import { ApiError } from './client';

/**
 * Turning a failure into something a person can act on.
 *
 * The copy rule this file exists to enforce: an error states what happened
 * and what to do, and never says "Something went wrong". That sentence is the
 * worst of both worlds — it admits a failure while withholding the one detail
 * that would let the reader decide whether to retry, fix their input, or go
 * and start the server.
 *
 * Most of the work is already done by the API: §12 makes every domain error a
 * typed class whose message is written as a sentence for a reader, and
 * `routes/errors.ts` sends it verbatim. So the job here is not to rewrite
 * those — it is to (1) add the "and what to do" half where the server has no
 * way to know it, and (2) say something useful for the failures that never
 * reach the server at all.
 */

export interface ErrorDescription {
  /** What happened, as a sentence. */
  readonly message: string;
  /** What to do about it. Omitted when the message already says. */
  readonly action?: string;
  /** The machine-readable code, shown small — for reporting, not for reading. */
  readonly code?: string;
}

/**
 * A `fetch` that never reached the server.
 *
 * The client deliberately does not catch this: a rejected `fetch` is not an
 * API error and inventing an `ApiError` with a made-up status would blur the
 * two. It is recognised here instead, where the difference between "the
 * server said no" and "there is no server" is exactly what the reader needs.
 */
function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

export function describeError(error: unknown): ErrorDescription {
  if (isNetworkFailure(error)) {
    return {
      message: 'The application could not reach the server.',
      action:
        'Check that the API is running on 127.0.0.1:3000, then try again.',
    };
  }

  if (!(error instanceof ApiError)) {
    return {
      message: 'The browser could not complete that.',
      action:
        'Try again. If it keeps happening, the details are in the console.',
    };
  }

  if (error.code === 'invalid_request') {
    return {
      message: 'Some of what was entered cannot be saved as it is.',
      action: 'The fields with a message under them need attention.',
      code: error.code,
    };
  }

  if (error.isUnauthenticated) {
    /*
      Two different 401s, distinguished by the server's own code rather than
      by the status. `authentication_required` comes from the guard and means
      the session is gone. `authentication_failed` comes from `/auth/login`
      and `/auth/change-credentials` and means the credentials were wrong —
      telling somebody at the sign-in screen that their session has ended is
      both untrue and useless.

      The message is passed through untouched in that case, and that is the
      point: §5a makes it one sentence for a wrong password and for an unknown
      username alike, and rewriting it here is how that guarantee would be
      lost.
    */
    if (error.code === 'authentication_failed') {
      return { message: error.message, code: error.code };
    }

    return {
      message: 'Your session has ended.',
      action: 'Sign in again to continue.',
      code: error.code,
    };
  }

  if (error.needsPasswordChange) {
    return {
      message: 'The default password is still in place.',
      action: 'Change it before recording anything.',
      code: error.code,
    };
  }

  if (error.status === 429) {
    return {
      message: 'Too many attempts in a row.',
      action: 'Wait a minute, then try once more.',
      code: error.code,
    };
  }

  if (error.status >= 500) {
    // Never the server's 500 body: it says "Something went wrong." on
    // purpose, so that a SQLite string or a file path cannot escape. Which
    // means this is the one case where the sentence has to be written here.
    return {
      message: 'The server could not complete that.',
      action:
        'The reason is in the terminal running the API — it logs the error in full.',
      code: error.code,
    };
  }

  // 400, 404, 409, 422: a typed domain error, whose message is already a
  // sentence written for this reader (§12). Repeating it in our own words
  // would only be a second place for it to go stale.
  return { message: error.message, code: error.code };
}

/**
 * Field-level messages from a validation failure, keyed by field name.
 *
 * `apps/api/src/routes/validate.ts` sends `details.issues` as
 * `{ path, message }` pairs precisely so a form can put each message under
 * the input it belongs to. A form that showed only "Invalid request body"
 * would be making the reader guess which of eleven fields it meant.
 */
export function fieldErrors(error: unknown): Readonly<Record<string, string>> {
  if (!(error instanceof ApiError) || error.code !== 'invalid_request') {
    return {};
  }

  const issues = (
    error.details as { issues?: readonly { path: string; message: string }[] }
  )?.issues;

  if (issues === undefined) return {};

  const byField: Record<string, string> = {};

  for (const issue of issues) {
    // First message per field wins: two messages stacked under one input is
    // noise, and zod reports the most specific one first.
    byField[issue.path] ??= issue.message;
  }

  return byField;
}

/** §5a's policy violations, when a password was rejected. */
export function policyViolations(error: unknown): readonly string[] {
  if (!(error instanceof ApiError) || error.code !== 'password_policy') {
    return [];
  }

  // Top-level on this route, not under `details` — which is why `ApiError`
  // keeps the whole body.
  const violations = (
    error.body as { violations?: readonly string[] } | undefined
  )?.violations;

  return violations ?? [];
}
