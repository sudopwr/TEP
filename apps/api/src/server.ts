import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  registerPasswordChangedGuard,
  registerSessionGuard,
} from './auth/guards';
import { buildContainer, type ContainerOptions } from './container';
import type { SqliteDatabase } from './db/connection';
import { registerAccountRoutes } from './routes/accounts';
import { registerAuthRoutes } from './routes/auth';

/**
 * Every field whose value could be a password, at every place a logger might
 * find one (N9, §5a "never log an attempted password").
 *
 * Fastify does not serialise request bodies by default, so most of these can
 * never fire as things stand. They are here because the day somebody adds
 * `request.log.info({ body })` to debug a login, the password must already
 * be unloggable — a redaction rule added after that line is added is a rule
 * added after the password reached the disk.
 */
export const REDACTED_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'body.password',
  'body.newPassword',
  'body.currentPassword',
  'passwordHash',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export interface ServerOptions extends ContainerOptions {
  readonly database: SqliteDatabase;
  readonly sessionSecret: string;
  readonly logger?: boolean;
}

/**
 * Build the server, guards and all.
 *
 * The order below is the whole of §5a's first constraint, and it is
 * load-bearing:
 *
 *   1. cookie, so a guard can read one;
 *   2. rate limiting, so a brute-force attempt is slowed before it is judged;
 *   3. the session guard;
 *   4. the must-change guard, which only ever runs on an authenticated
 *      request because (3) already returned for the others;
 *   5. routes.
 *
 * Both guards are `addHook` on the root instance, so they apply to every
 * route registered on it — including routes added in a later stage, which
 * are protected the moment they exist without anyone remembering to say so.
 */
export async function buildServer(
  options: ServerOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger === true && {
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    },
    ajv: {
      customOptions: {
        // Fastify defaults this to true, which silently DELETES a field the
        // schema does not declare instead of rejecting it. On a credentials
        // endpoint that turns a typo'd `newPasword` into a 200 that changed
        // nothing, and the person believes their password has changed.
        removeAdditional: false,
      },
    },
  });

  const container = buildContainer(options.database, options);

  await app.register(cookie, { secret: options.sessionSecret });
  await app.register(rateLimit, {
    global: false,
    // Loopback means one client, so a shared bucket would let a legitimate
    // burst of page loads lock the owner out of their own machine. Only
    // /auth/login opts in, via its route config.
    max: 5,
    timeWindow: '1 minute',
  });

  registerSessionGuard(app, { authenticate: container.authenticate });
  registerPasswordChangedGuard(app);

  app.get('/health', () => ({ status: 'ok' }));

  registerAuthRoutes(app, container);
  registerAccountRoutes(app, container);

  return app;
}
