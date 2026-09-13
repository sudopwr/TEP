import path from 'node:path';
import process from 'node:process';

import type { FastifyInstance } from 'fastify';

import { assertSafeBindAddress } from './auth/bind-address';
import { loadOrCreateSessionSecret } from './auth/session-secret';
import { buildContainer } from './container';
import { openDatabase, type SqliteDatabase } from './db/connection';
import { migrate } from './db/migrate';
import { buildServer } from './server';

export interface BootstrapOptions {
  readonly host?: string;
  /** 0 asks the OS for a free one, and `address` reports which. */
  readonly port?: number;
  readonly databasePath?: string;
  /**
   * Where `data/files` lives.
   *
   * N6 says the data is `app.db` plus `files/` and that a backup is a copy of
   * that folder — so the two have to be able to move together. Only the
   * database could, until this.
   */
  readonly filesRoot?: string;
  readonly envFile?: string;
  /**
   * Operational output: request logs and the console banners below.
   *
   * One switch rather than two, because they are one thing — a caller that
   * passes `false` is saying there is no operator watching a console, and a
   * first-run notice printed to nobody is just noise in a test report.
   */
  readonly logger?: boolean;
}

export interface StartedServer {
  readonly app: FastifyInstance;
  readonly database: SqliteDatabase;
  readonly address: string;
  close(): Promise<void>;
}

/**
 * Start the API.
 *
 * The order matters. Migrate, then read the must-change flag, then check the
 * bind address, and only then listen. Checking after `listen` would mean the
 * socket was already reachable when we decided it should not have been.
 */
export async function start(
  options: BootstrapOptions = {},
): Promise<StartedServer> {
  // N7: binds loopback by default, and `assertSafeBindAddress` below
  // refuses anything else while the shipped password is still in place.
  const host = options.host ?? process.env['HOST'] ?? '127.0.0.1';
  const port = Number(options.port ?? process.env['PORT'] ?? 3000);
  const databasePath =
    options.databasePath ??
    process.env['PAYOUT_DB'] ??
    path.resolve('data', 'app.db');
  const filesRoot =
    options.filesRoot ??
    process.env['PAYOUT_FILES'] ??
    path.resolve('data', 'files');

  const database = openDatabase(databasePath);

  try {
    migrate(database);

    const { hasher, users } = buildContainer(database, { filesRoot });
    const admin = await users.findById(1);

    // N10 and §5a's second constraint. Before listen, never after.
    assertSafeBindAddress({
      host,
      mustChangePassword: admin?.mustChangePassword ?? false,
    });

    const speak = options.logger ?? true;

    const { secret, source } = loadOrCreateSessionSecret(
      options.envFile ?? path.resolve('.env'),
    );

    if (source === 'generated' && speak) {
      process.stdout.write(
        'Generated a new SESSION_SECRET into .env. Existing sign-ins are now invalid.\n',
      );
    }

    // Pay for the dummy hash now, so the first unknown-username sign-in is
    // not measurably faster than every one after it.
    await hasher.warmUp();

    const app = await buildServer({
      database,
      sessionSecret: secret,
      filesRoot,
      logger: speak,
    });

    const address = await app.listen({ host, port });

    if (admin?.mustChangePassword === true && speak) {
      process.stdout.write(
        `\nListening on ${address}\n` +
          '\nThe default password (admin / admin) is still in place.\n' +
          'Every data route returns 403 and this server will not leave 127.0.0.1\n' +
          'until it is changed. See CLAUDE.md section 5a.\n\n',
      );
    }

    return {
      app,
      database,
      address,
      close: async () => {
        await app.close();
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

const invokedDirectly = process.argv[1]?.endsWith('main.ts') === true;

if (invokedDirectly) {
  try {
    await start();
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
