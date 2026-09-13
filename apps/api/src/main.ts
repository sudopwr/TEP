import path from 'node:path';
import process from 'node:process';

import type { FastifyInstance } from 'fastify';

import { assertSafeBindAddress } from './auth/bind-address';
import { loadOrCreateSessionSecret } from './auth/session-secret';
import { buildContainer } from './container';
import { openDatabase, type SqliteDatabase } from './db/connection';
import { migrate } from './db/migrate';
import { defaultWebRoot, webAppIsBuilt } from './routes/web';
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
  /**
   * Where the built interface is.
   *
   * Serving it from this process is what makes `npm start` one command and
   * one origin — see `routes/web.ts`. Point it at nothing and the server is
   * an API alone, which is what `npm run dev` wants while Vite is serving the
   * interface with hot reload.
   */
  readonly webRoot?: string;
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
  const webRoot =
    options.webRoot ?? process.env['PAYOUT_WEB'] ?? defaultWebRoot();

  const database = openDatabase(databasePath);

  try {
    const migrated = migrate(database);

    const { hasher, users } = buildContainer(database, { filesRoot });
    const admin = await users.findById(1);

    // N10 and §5a's second constraint. Before listen, never after.
    assertSafeBindAddress({
      host,
      mustChangePassword: admin?.mustChangePassword ?? false,
    });

    const speak = options.logger ?? true;

    if (migrated.repaired.length > 0 && speak) {
      /*
        Said loudly, because it is the one thing that must never happen
        quietly: the users table was empty, so the shipped credential has been
        put back and this installation now answers to `admin` / `admin` again.
        F15's cage is back on with it — every data route 403s and the server
        will not leave loopback — but somebody who does not know this happened
        is somebody with a default password they did not choose.
      */
      process.stdout.write(
        [
          '',
          'There were no user accounts, so the shipped credential has been restored.',
          'Sign in as admin / admin. You will be made to change it before anything',
          'else works, and this server will not leave 127.0.0.1 until you do.',
          '',
          '',
        ].join('\n'),
      );
    }

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
      webRoot,
      logger: speak,
    });

    const address = await app.listen({ host, port });

    if (speak && !webAppIsBuilt(webRoot)) {
      // Said plainly rather than left to be discovered as a 404. The API is
      // perfectly usable like this — it is what `npm run dev` does — but
      // somebody who ran `npm start` expecting a screen needs to know why
      // there isn't one.
      process.stdout.write(
        [
          '',
          `Listening on ${address}`,
          '',
          'No interface found at:',
          `  ${webRoot}`,
          'The API is running, but nothing is serving the screens.',
          'Run `npm run build` first, or `npm run dev` for hot reload.',
          '',
          '',
        ].join('\n'),
      );
    }

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
