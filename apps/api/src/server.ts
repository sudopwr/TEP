import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  registerPasswordChangedGuard,
  registerSessionGuard,
} from './auth/guards';
import { buildContainer, type ContainerOptions } from './container';
import type { DocumentFileSource, UseCases } from './decorators';
import type { SqliteDatabase } from './db/connection';
import { registerApiRoutes } from './routes/api';
import { registerAuthRoutes } from './routes/auth';
import { registerErrorHandler } from './routes/errors';
import { registerWebApp, serveIndex, webAppIsBuilt } from './routes/web';

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

/** 25MB. A trading statement is a few hundred KB; a video is not a document. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface ServerOptions extends ContainerOptions {
  readonly database: SqliteDatabase;
  readonly sessionSecret: string;
  readonly logger?: boolean;
  /** Swap in fakes without a database. Tests only; the container wins if absent. */
  readonly useCases?: UseCases;
  readonly documentFiles?: DocumentFileSource;
  /**
   * Where `apps/web/dist` is, when the interface is being served too.
   *
   * Omitted — or pointing at a directory with no `index.html` — and the
   * server is an API and nothing else. That is what `npm run dev` wants,
   * since Vite is serving the interface then, and it is what every
   * integration test wants, since none of them builds the web app.
   */
  readonly webRoot?: string;
}

/**
 * Build the server, guards and all.
 *
 * The order below is the whole of §5a's first constraint, and it is
 * load-bearing:
 *
 *   1. cookie, so a guard can read one;
 *   2. multipart and rate limiting;
 *   3. the error handler, before any route can throw;
 *   4. the session guard;
 *   5. the must-change guard, which only ever runs on an authenticated
 *      request because (4) already returned for the others;
 *   6. routes.
 *
 * Both guards are `addHook` on the root instance, so they apply to every
 * route registered on it — including routes added in a later stage, which
 * are protected the moment they exist without anyone remembering to say so.
 * That is why `/api/*` needs no per-route annotation to be guarded.
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
        //
        // The /api routes validate with zod and do not rely on this; the auth
        // routes do.
        removeAdditional: false,
      },
    },
  });

  const container = buildContainer(options.database, options);

  // Routes reach these through the instance and never import an adapter.
  app.decorate('useCases', options.useCases ?? container.useCases);
  app.decorate(
    'documentFiles',
    options.documentFiles ?? container.documentFiles,
  );

  await app.register(cookie, { secret: options.sessionSecret });
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });
  await app.register(rateLimit, {
    global: false,
    // Loopback means one client, so a shared bucket would let a legitimate
    // burst of page loads lock the owner out of their own machine. Only
    // /auth/login opts in, via its route config.
    max: 5,
    timeWindow: '1 minute',
  });

  /*
    The interface, if there is one to serve.

    Registered before the guards so that `@fastify/static`'s route exists by
    the time they run — they recognise it by name. The guards still apply to
    it; it is simply on their exemption list, like `/health`.
  */
  const servesTheInterface =
    options.webRoot !== undefined && webAppIsBuilt(options.webRoot);

  if (servesTheInterface) {
    await registerWebApp(app, options.webRoot as string);
  }

  registerErrorHandler(app, servesTheInterface ? { notFound: serveIndex } : {});

  registerSessionGuard(app, { authenticate: app.useCases.authenticate });
  registerPasswordChangedGuard(app);

  app.get('/health', () => ({ status: 'ok' }));

  registerAuthRoutes(app, app.useCases);
  registerApiRoutes(app);

  return app;
}
