/**
 * apps/api — Fastify + better-sqlite3.
 *
 * Adapters implement core's ports; routes stay thin; `container.ts` is the
 * only file that knows about everything.
 */
export { buildContainer, type Container } from './container';
export { buildServer, type ServerOptions } from './server';
export { start, type BootstrapOptions, type StartedServer } from './main';
export { openDatabase, type SqliteDatabase } from './db/connection';
export { migrate } from './db/migrate';
