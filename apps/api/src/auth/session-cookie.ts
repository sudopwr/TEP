import type { CookieSerializeOptions } from '@fastify/cookie';

import { SESSION_LIFETIME_MS } from '@payout/core';

/**
 * The session cookie (§5a).
 *
 * It carries the session id and nothing else. Everything about the session —
 * who it belongs to, when it expires, whether it has been revoked — lives in
 * a row, so the cookie has nothing worth reading and nothing worth tampering
 * with. Signing it is belt and braces: a forged id would fail the lookup
 * anyway, but a signature means a garbled cookie is rejected before it
 * reaches the database at all.
 */
export const SESSION_COOKIE = 'payout_session';

/**
 * `secure: false` is correct here and only here.
 *
 * Loopback has no TLS, and a `secure` cookie would never be sent over plain
 * http, so setting it would break sign-in entirely rather than harden it.
 * §11 records the condition for changing it: if this app ever sits behind
 * TLS, this becomes `true` in the same commit.
 */
export function sessionCookieOptions(
  maxAgeMs: number = SESSION_LIFETIME_MS,
): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    signed: true,
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

/** The same attributes with no lifetime, which is how a cookie is cleared. */
export function clearedSessionCookieOptions(): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
  };
}
