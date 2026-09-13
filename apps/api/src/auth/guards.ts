import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  SessionInvalidError,
  type AuthenticateSession,
  type Session,
  type User,
} from '@payout/core';

import { isApiPath } from '../routes/web';

import {
  SESSION_COOKIE,
  clearedSessionCookieOptions,
  sessionCookieOptions,
} from './session-cookie';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by requireSession on every request that reaches a handler. */
    user?: User;
    session?: Session;
  }
}

/**
 * Routes that are never *rejected* for want of a session.
 *
 * An explicit exemption list, not an opt-in marker on each protected route.
 * The difference is what happens when somebody adds a route and forgets:
 * with an opt-in, the new route is public; with this, it is protected. A
 * forgotten route should fail closed.
 *
 * `/health` is here because a liveness check that needs a credential is not
 * a liveness check. `/auth/login` because you cannot sign in through a guard
 * that requires being signed in. `/auth/logout` because signing out must work
 * with a cookie that has already expired — that is the case it is for.
 *
 * Note what is NOT here: `/auth/me` and `/auth/change-credentials`. Both need
 * to know who is asking, and both are specified to answer 401 when nobody is.
 * They are exempt from the *password* guard below, not from this one.
 *
 * A request to a route on this list is still identified where it can be: a
 * valid cookie populates `request.user`, an invalid one is ignored rather
 * than rejected. That is what lets `/auth/logout` work with a cookie that
 * has already expired instead of 401ing the person who is trying to leave.
 */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  '/health',
  '/auth/login',
  '/auth/logout',
]);

/**
 * Routes reachable while `must_change_password` is set (§5a).
 *
 * This plus the list above is exactly §5a's five: `/health`, `/auth/login`,
 * `/auth/me`, `/auth/logout`, `/auth/change-credentials`. `/auth/me` so the
 * UI can discover the flag, `/auth/change-credentials` so it can be cleared,
 * `/auth/logout` so a person can leave. Nothing else.
 */
export const MUST_CHANGE_EXEMPT: ReadonlySet<string> = new Set([
  '/auth/me',
  '/auth/logout',
  '/auth/change-credentials',
]);

/** The code a client branches on. F15's 403 has to be machine-readable. */
export const PASSWORD_CHANGE_REQUIRED = 'password_change_required';
export const AUTHENTICATION_REQUIRED = 'authentication_required';

/**
 * Match on the route's registered path, not the URL.
 *
 * `request.routeOptions.url` is the pattern Fastify matched (`/payouts/:id`),
 * so a query string, a trailing slash or an encoded path cannot be used to
 * dodge the comparison. A 404 has no matched route, and falls through to the
 * raw url, which matches nothing and so stays guarded.
 */
function routeKey(request: FastifyRequest): string {
  return request.routeOptions.url ?? request.url;
}

/**
 * A request for the interface itself — the HTML, the bundle, the fonts.
 *
 * Public of necessity: nobody can sign in through a screen they cannot load.
 * The definition is deliberately narrow, so that "the interface is public"
 * never becomes "anything we forgot to register is public". Three conditions,
 * all of them:
 *
 *   - a GET or a HEAD, so no write is ever waved through;
 *   - not an API address, so a mistyped `/api/payout` is still refused with a
 *     401 rather than told that it does not exist;
 *   - and either a route the static plugin registered — which the server
 *     records as it happens, rather than guessing at the pattern — or *no
 *     route at all*, which is the SPA fallback and can only ever answer with
 *     `index.html`.
 *
 * So a new `/api` handler is guarded on the day it is written, and so is a
 * root-level one: it is neither an interface route nor unmatched.
 */
function requestsTheInterface(request: FastifyRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  if (isApiPath(request.url)) {
    return false;
  }

  const matched = request.routeOptions.url;

  if (matched === undefined) {
    return true;
  }

  return request.server.interfaceRoutes?.has(matched) === true;
}

export interface GuardDependencies {
  readonly authenticate: AuthenticateSession;
}

/**
 * Guard 1 — everything except `/health` and the auth routes needs a session.
 *
 * Registered with `addHook` on the instance, so it applies to every route
 * registered on it, including ones added later.
 */
export function registerSessionGuard(
  app: FastifyInstance,
  deps: GuardDependencies,
): void {
  app.addHook('onRequest', async (request, reply) => {
    const isPublic =
      PUBLIC_ROUTES.has(routeKey(request)) || requestsTheInterface(request);
    const presented = readSessionId(request);

    if (presented === null) {
      if (!isPublic) {
        await unauthenticated(reply);
      }
      return;
    }

    try {
      const { user, session, extended } = await deps.authenticate.execute({
        sessionId: presented,
      });

      request.user = user;
      request.session = session;

      if (extended) {
        // UC12 pushed the expiry out; the cookie should say so too, or the
        // browser drops it while the row is still good.
        reply.setCookie(SESSION_COOKIE, session.id, sessionCookieOptions());
      }
    } catch (error) {
      if (error instanceof SessionInvalidError) {
        // Expired, revoked or forged — one response for all three. The
        // client has nothing to do differently, and telling it which would
        // confirm that a guessed id once existed.
        if (!isPublic) {
          await unauthenticated(reply);
        }
        return;
      }
      throw error;
    }
  });
}

/**
 * Guard 2 — 403 while the shipped password is still in place (§5a, F15).
 *
 * Runs after the session guard, on the same hook, so it only ever sees an
 * authenticated request. Order is registration order, which is why the
 * bootstrap registers them in this order and why they are two hooks rather
 * than one: they answer different questions and return different codes.
 */
export function registerPasswordChangedGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    const key = routeKey(request);

    // Reachable while the flag is set: anything that needs no session at all
    // (it never had a user to check), plus the three routes that exist to
    // clear the flag, plus the interface — which has to load in order to show
    // the screen that clears it. Everything else 403s.
    if (
      PUBLIC_ROUTES.has(key) ||
      MUST_CHANGE_EXEMPT.has(key) ||
      requestsTheInterface(request)
    ) {
      return;
    }

    if (request.user?.mustChangePassword === true) {
      await reply.status(403).send({
        code: PASSWORD_CHANGE_REQUIRED,
        message:
          'The default password is still in place. Change it before using the application.',
      });
    }
  });
}

/** The session id from the signed cookie, or null if there isn't a good one. */
export function readSessionId(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (raw === undefined) {
    return null;
  }

  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || unsigned.value === null) {
    return null;
  }

  return unsigned.value;
}

/**
 * 401, and clear the cookie on the way out.
 *
 * Clearing matters: without it a browser holding a revoked cookie re-presents
 * it on every request forever, and the person sees a login screen that their
 * own browser keeps undoing.
 */
async function unauthenticated(reply: FastifyReply): Promise<void> {
  await reply
    .clearCookie(SESSION_COOKIE, clearedSessionCookieOptions())
    .status(401)
    .send({
      code: AUTHENTICATION_REQUIRED,
      message: 'Sign in to continue.',
    });
}
