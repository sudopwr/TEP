import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * The built interface, served by the same process as the API.
 *
 * One process and one origin, which is the point: §5a's cookie is `httpOnly`,
 * `sameSite=lax` and has no domain, so it only works when the browser believes
 * the UI and the API are the same site. In development Vite's proxy pretends
 * they are; in production they actually are, and there is nothing to pretend.
 *
 * This is the one static mount in the application, and it is worth saying why
 * it does not contradict §13's "documents are served by a handler, never a
 * static mount". That rule is about `data/files`, where publishing everything
 * would hand out every stored statement to anyone who can guess a hash. This
 * mount points at a directory of compiled JavaScript and fonts that is
 * downloaded by every visitor by definition. The two directories are not the
 * same kind of thing.
 */

/** `apps/web/dist`, found relative to this file rather than to the cwd. */
export function defaultWebRoot(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'web',
    'dist',
  );
}

/**
 * The prefixes the API owns. Nothing under them is ever the interface.
 *
 * The SPA fallback exists to turn `/payouts/1` into `index.html` so the router
 * can read the address. What it must never do is turn a mistyped `/api/payout`
 * into `index.html`, because a client asking for JSON would then receive a
 * page of HTML with a 200 on it and report the failure as a parse error three
 * layers away from the typo.
 */
const API_PREFIXES = ['/api', '/auth', '/health'] as const;

export function isApiPath(url: string): boolean {
  const [pathname = ''] = url.split('?');

  return API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * The routes that serve the interface, as the plugin registered them.
     *
     * Recorded rather than assumed. `@fastify/static` with `wildcard: false`
     * registers one route per file it finds — `/` and `/index.html` for this
     * build, and something else for the next one — so a guard that matched a
     * hard-coded `/*` would silently refuse the very page it was meant to let
     * through. Absent when no interface is served.
     */
    interfaceRoutes?: ReadonlySet<string>;
  }
}

export function webAppIsBuilt(root: string): boolean {
  return existsSync(path.join(root, 'index.html'));
}

/**
 * Serve the files, and hand every other address to the router.
 *
 * `wildcard: false` so the plugin serves a file when there is one and calls
 * the not-found handler when there is not, rather than answering 404 itself —
 * the fallback below needs to see those.
 *
 * No long-lived cache headers, though every filename here is content-hashed
 * and could carry them. This is a bundle read off local disk over loopback,
 * where the saving is unmeasurable; and the cost of getting it wrong is the
 * one bug that looks like the code not having changed at all. `index.html`
 * in particular must never be cached, and the surest way to hold that is to
 * not be caching anything.
 */
export async function registerWebApp(
  app: FastifyInstance,
  root: string,
): Promise<void> {
  const registered = new Set<string>();
  let recording = true;

  app.decorate('interfaceRoutes', registered as ReadonlySet<string>);
  app.addHook('onRoute', (route) => {
    if (recording) {
      registered.add(route.url);
    }
  });

  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    wildcard: false,
  });

  // Awaiting the registration flushes the plugin, so every route it adds is
  // in the set by now. Everything registered after this point is the API, and
  // the guards must go on treating it that way.
  recording = false;
}

/**
 * `index.html` for anything that is not an API address.
 *
 * Called from the not-found handler, which is the only place that knows a
 * request matched no route at all.
 */
export function serveIndex(
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return null;
  }

  if (isApiPath(request.url)) {
    return null;
  }

  return reply.type('text/html').header('cache-control', 'no-cache').sendFile(
    'index.html',
  );
}
