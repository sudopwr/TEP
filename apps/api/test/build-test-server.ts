import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance, InjectOptions } from 'fastify';

import * as reference from '@core/domain/reference-payout.fixture';

import { bulkLoad } from '../src/adapters/maintenance';
import type { SqliteDatabase } from '../src/db/connection';
import { buildServer } from '../src/server';

import { openTestDatabase } from './open-test-database';

/**
 * A clock the route tests can move, matching the one the use-case tests use.
 *
 * The alternative — waiting thirty days for a session to expire — is not an
 * alternative.
 */
export class ControllableClock {
  #instant: Date;

  constructor(iso = '2025-03-16T10:30:00.000Z') {
    this.#instant = new Date(iso);
  }

  now(): Date {
    return new Date(this.#instant.getTime());
  }

  today(): string {
    return this.#instant.toISOString().slice(0, 10);
  }

  set(iso: string): void {
    this.#instant = new Date(iso);
  }

  advanceDays(days: number): void {
    this.#instant = new Date(
      this.#instant.getTime() + days * 24 * 60 * 60 * 1000,
    );
  }
}

export interface TestServer {
  readonly app: FastifyInstance;
  readonly database: SqliteDatabase;
  readonly clock: ControllableClock;
  readonly filesRoot: string;
  close(): Promise<void>;
}

export interface BuildTestServerOptions {
  /** Seed the reference payout so the read endpoints have something to read. */
  readonly seed?: (database: SqliteDatabase) => void;
  /**
   * A built interface to serve alongside the API.
   *
   * Omitted by default, because almost no test wants one: the API's own
   * integration tests are about the API, and building the web app to run them
   * would tie a Fastify test to a Vite build.
   */
  readonly webRoot?: string;
}

/**
 * The real server, the real schema, the real argon2 — in memory.
 *
 * Nothing is mocked: `:memory:` SQLite with the migrations applied, the real
 * container, the real guards, the real file store in a throwaway directory.
 * The only substitutions are a clock a test can move and a database that
 * disappears when the test ends.
 */
export async function buildTestServer(
  options: BuildTestServerOptions = {},
): Promise<TestServer> {
  const database = openTestDatabase();
  options.seed?.(database);

  const clock = new ControllableClock();
  const filesRoot = mkdtempSync(path.join(tmpdir(), 'payout-api-files-'));

  const app = await buildServer({
    database,
    sessionSecret: 'test-secret-not-a-real-one',
    clock,
    filesRoot,
    ...(options.webRoot === undefined ? {} : { webRoot: options.webRoot }),
  });

  return {
    app,
    database,
    clock,
    filesRoot,
    close: async () => {
      await app.close();
      database.close();
    },
  };
}

/** The `Set-Cookie` value for one cookie, as a browser would re-present it. */
export function cookieFrom(
  response: { cookies: { name: string; value: string }[] },
  name = 'payout_session',
): string | null {
  const found = response.cookies.find((one) => one.name === name);
  if (found === undefined || found.value.length === 0) {
    return null;
  }
  return `${name}=${found.value}`;
}

const NEW_PASSWORD = 'a quiet harbour lamp';

/**
 * Sign in and come back with a cookie that opens the data routes.
 *
 * Two steps, not one, and both are real. Signing in as `admin` gets a valid
 * session — and a session that every `/api/*` route answers 403 to, because
 * `must_change_password` is still set (§5a). So the helper also changes the
 * password, through the real endpoint, with the real policy applied.
 *
 * Deliberately not a shortcut that writes a session row directly: a helper
 * that bypassed sign-in would let a regression in sign-in, in the cookie
 * signature, or in either guard sit undetected behind a green suite. Every
 * authenticated test below pays for a real login, and that is the point.
 */
export async function authenticate(server: TestServer): Promise<string> {
  const loggedIn = await server.app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username: 'admin', password: 'admin' },
  });

  const cookie = cookieFrom(loggedIn);
  if (cookie === null) {
    throw new Error('sign-in issued no session cookie');
  }

  const changed = await server.app.inject({
    method: 'POST',
    url: '/auth/change-credentials',
    headers: { cookie },
    payload: { currentPassword: 'admin', newPassword: NEW_PASSWORD },
  });

  if (changed.statusCode !== 200) {
    throw new Error(
      `could not clear the must-change flag: ${String(changed.statusCode)} ${changed.body}`,
    );
  }

  return cookie;
}

/** A signed-in request. Every `/api` test goes through this. */
export function asUser(
  server: TestServer,
  cookie: string,
  options: InjectOptions,
): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
  return server.app.inject({
    ...options,
    headers: { ...options.headers, cookie },
  });
}

/**
 * Seeds for `buildTestServer`, so the read endpoints have something to read.
 *
 * The reference payout is the §10 tree — the same fixture the domain tests
 * assert ₹84,642.93 against. Using it here means the route tests are checking
 * the numbers that actually left the database, not numbers invented for a
 * route test.
 */
export const seedCounterparties = (database: SqliteDatabase): void => {
  bulkLoad(database, {
    companies: [reference.TRADEIFY, reference.RISE_CO],
    accounts: [
      reference.TRADEIFY_ACCOUNT,
      reference.RISE,
      reference.TRUSTWALLET,
      reference.COINDCX,
      reference.BANK,
    ],
    feeSchedules: [...reference.FEE_SCHEDULES],
  });
};

export const seedReferencePayout = (database: SqliteDatabase): void => {
  seedCounterparties(database);
  bulkLoad(database, {
    payouts: [reference.PAYOUT],
    transactions: [...reference.TRANSACTIONS],
    fees: [...reference.FEES],
  });
};

export { reference };
