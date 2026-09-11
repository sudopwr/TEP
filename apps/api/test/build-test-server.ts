import type { FastifyInstance } from 'fastify';

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
  close(): Promise<void>;
}

/** The real server, the real schema, the real argon2 — an in-memory file. */
export async function buildTestServer(): Promise<TestServer> {
  const database = openTestDatabase();
  const clock = new ControllableClock();

  const app = await buildServer({
    database,
    sessionSecret: 'test-secret-not-a-real-one',
    clock,
  });

  return {
    app,
    database,
    clock,
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
