import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  AuthenticationFailedError,
  InvalidUsernameError,
  PasswordPolicyError,
  UsernameTakenError,
  type ChangeCredentials,
  type SignIn,
  type SignOut,
} from '@payout/core';

import { readSessionId } from '../auth/guards';
import {
  SESSION_COOKIE,
  clearedSessionCookieOptions,
  sessionCookieOptions,
} from '../auth/session-cookie';

export interface AuthRouteDependencies {
  readonly signIn: SignIn;
  readonly signOut: SignOut;
  readonly changeCredentials: ChangeCredentials;
}

interface LoginBody {
  readonly username?: unknown;
  readonly password?: unknown;
}

interface ChangeBody {
  readonly currentPassword?: unknown;
  readonly newUsername?: unknown;
  readonly newPassword?: unknown;
}

/**
 * Fastify schemas, so a malformed body is a 400 before a use case sees it.
 *
 * `additionalProperties: false` on the change body matters more than it
 * looks: without it, a typo'd `newPasword` is silently ignored and the
 * caller is told their credentials changed when only the typo did.
 */
const LOGIN_SCHEMA = {
  body: {
    type: 'object',
    required: ['username', 'password'],
    additionalProperties: false,
    properties: {
      username: { type: 'string', maxLength: 256 },
      password: { type: 'string', maxLength: 4096 },
    },
  },
} as const;

const CHANGE_SCHEMA = {
  body: {
    type: 'object',
    required: ['currentPassword'],
    additionalProperties: false,
    properties: {
      currentPassword: { type: 'string', maxLength: 4096 },
      newUsername: { type: 'string', maxLength: 64 },
      newPassword: { type: 'string', maxLength: 4096 },
    },
  },
} as const;

/** The single response for every sign-in failure. Built once, sent always. */
const SIGN_IN_FAILED = {
  code: 'authentication_failed',
  message: AuthenticationFailedError.MESSAGE,
} as const;

/**
 * The auth routes (F14, F16, F17).
 *
 * Thin, per §5: parse, call a use case, serialize. The one thing that is not
 * thin is the login handler's failure path, and that is the point — an
 * identical body, an identical status and an identical shape whichever way
 * it failed.
 */
export function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRouteDependencies,
): void {
  app.post(
    '/auth/login',
    {
      schema: LOGIN_SCHEMA,
      config: {
        // §5a: five attempts a minute, then a short lockout. Applied per IP,
        // which on a loopback-only app means per machine — it is a brake on
        // an automated guesser, not an access-control mechanism.
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
    },
    async (request: FastifyRequest<{ Body: LoginBody }>, reply) => {
      const { username, password } = request.body;

      try {
        const result = await deps.signIn.execute({
          username: String(username),
          password: String(password),
        });

        return await reply
          .setCookie(
            SESSION_COOKIE,
            result.session.id,
            sessionCookieOptions(
              Date.parse(result.session.expiresAt) - Date.now(),
            ),
          )
          .send({
            username: result.user.username,
            mustChangePassword: result.mustChangePassword,
          });
      } catch (error) {
        if (error instanceof AuthenticationFailedError) {
          // One body, one status, both failures. `error.failure` is not read
          // here and never reaches the client.
          return await reply.status(401).send(SIGN_IN_FAILED);
        }
        throw error;
      }
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const sessionId = readSessionId(request);

    if (sessionId !== null) {
      await deps.signOut.execute({ sessionId });
    }

    // Always 204, always clears. Signing out with no cookie, an expired one
    // or a forged one all look the same from outside — anything else is a
    // session-id oracle on an unauthenticated route.
    return reply
      .clearCookie(SESSION_COOKIE, clearedSessionCookieOptions())
      .status(204)
      .send();
  });

  app.get('/auth/me', (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user;

    if (user === undefined) {
      return reply.status(401).send({
        code: 'authentication_required',
        message: 'Sign in to continue.',
      });
    }

    return reply.send({
      username: user.username,
      mustChangePassword: user.mustChangePassword,
    });
  });

  app.post(
    '/auth/change-credentials',
    { schema: CHANGE_SCHEMA },
    async (request: FastifyRequest<{ Body: ChangeBody }>, reply) => {
      const user = request.user;

      if (user === undefined) {
        return await reply.status(401).send({
          code: 'authentication_required',
          message: 'Sign in to continue.',
        });
      }

      const body = request.body;

      try {
        const result = await deps.changeCredentials.execute({
          userId: user.id,
          currentPassword: String(body.currentPassword),
          ...(typeof body.newUsername === 'string'
            ? { newUsername: body.newUsername }
            : {}),
          ...(typeof body.newPassword === 'string'
            ? { newPassword: body.newPassword }
            : {}),
          ...(request.session === undefined
            ? {}
            : { currentSessionId: request.session.id }),
        });

        return await reply.send({
          username: result.user.username,
          mustChangePassword: result.user.mustChangePassword,
          passwordChanged: result.passwordChanged,
          usernameChanged: result.usernameChanged,
          otherSessionsRevoked: result.sessionsRevoked,
        });
      } catch (error) {
        return await respondToChangeFailure(error, reply);
      }
    },
  );
}

/**
 * Map a domain error to a status and a machine-readable code.
 *
 * Every branch sends `code` plus a message. The message is for a person; the
 * code is what a UI branches on, and what a test can assert without being
 * coupled to prose. No branch includes the password that was rejected.
 */
async function respondToChangeFailure(
  error: unknown,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (error instanceof AuthenticationFailedError) {
    return reply.status(401).send(SIGN_IN_FAILED);
  }

  if (error instanceof PasswordPolicyError) {
    return reply.status(400).send({
      code: 'password_policy',
      message: 'That password does not meet the policy.',
      violations: error.violations,
    });
  }

  if (error instanceof UsernameTakenError) {
    return reply.status(409).send({
      code: 'username_taken',
      message: 'That username is already in use.',
    });
  }

  if (error instanceof InvalidUsernameError) {
    return reply.status(400).send({
      code: 'invalid_username',
      message: error.message,
    });
  }

  throw error;
}
