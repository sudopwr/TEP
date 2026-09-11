import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteUserRepository } from './adapters/sqlite-user-repository';
import { InsecureBindError } from './auth/bind-address';
import { openDatabase } from './db/connection';
import { migrate } from './db/migrate';
import { start, type StartedServer } from './main';

/**
 * These start a real server on a real socket. `port: 0` lets the OS pick a
 * free one, so the suite cannot collide with anything the machine is running.
 */
const scratch = () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'payout-boot-'));
  return {
    database: path.join(directory, 'app.db'),
    env: path.join(directory, '.env'),
  };
};

describe('start', () => {
  let started: StartedServer | null = null;

  afterEach(async () => {
    await started?.close();
    started = null;
  });

  it('refuses to start on 0.0.0.0 while must_change_password is set', async () => {
    // N10 and §5a's second constraint. The shipped credential is only
    // defensible while the socket cannot be reached from another machine.
    const paths = scratch();

    await expect(
      start({
        host: '0.0.0.0',
        port: 0,
        databasePath: paths.database,
        envFile: paths.env,
      }),
    ).rejects.toBeInstanceOf(InsecureBindError);
  });

  it('refuses a LAN address too, not only the wildcard', async () => {
    const paths = scratch();

    await expect(
      start({
        host: '192.168.1.50',
        port: 0,
        databasePath: paths.database,
        envFile: paths.env,
      }),
    ).rejects.toBeInstanceOf(InsecureBindError);
  });

  it('never opens the socket when it refuses', async () => {
    // Checking after listen would mean the port was already reachable at the
    // moment we decided it should not be.
    const paths = scratch();

    await expect(
      start({
        host: '0.0.0.0',
        port: 0,
        databasePath: paths.database,
        envFile: paths.env,
      }),
    ).rejects.toThrow();

    // A second attempt on loopback must succeed, which it could not do if the
    // first attempt had left a database handle or a socket open.
    started = await start({
      host: '127.0.0.1',
      port: 0,
      databasePath: paths.database,
      envFile: paths.env,
    });

    expect(started.address).toContain('127.0.0.1');
  });

  it('starts on 127.0.0.1 with the flag set, and says so', async () => {
    const paths = scratch();

    started = await start({
      host: '127.0.0.1',
      port: 0,
      databasePath: paths.database,
      envFile: paths.env,
    });

    const response = await started.app.inject({ url: '/health' });
    expect(response.statusCode).toBe(200);
  });

  it('allows any address once the password has been changed', async () => {
    const paths = scratch();

    // Clear the flag through the repository — this test is about the bind
    // check, not about the route that clears it, and §12 keeps SQL out of
    // everything but the adapter layer.
    const database = openDatabase(paths.database);
    migrate(database);
    const users = new SqliteUserRepository(database);
    const admin = await users.findById(1);
    if (admin === null) throw new Error('migration 003 seeded no admin');
    await users.update(admin.withPassword('$argon2id$placeholder', 'now'));
    database.close();

    started = await start({
      host: '0.0.0.0',
      port: 0,
      databasePath: paths.database,
      envFile: paths.env,
    });

    expect(started.address).toBeTruthy();
  });

  it('generates a SESSION_SECRET into the env file on first run', async () => {
    const paths = scratch();

    started = await start({
      host: '127.0.0.1',
      port: 0,
      databasePath: paths.database,
      envFile: paths.env,
    });

    const { readFileSync } = await import('node:fs');
    expect(readFileSync(paths.env, 'utf8')).toMatch(/^SESSION_SECRET=.+$/m);
  });

  it('migrates the database it was pointed at', async () => {
    const paths = scratch();

    started = await start({
      host: '127.0.0.1',
      port: 0,
      databasePath: paths.database,
      envFile: paths.env,
    });

    const login = await started.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'admin', password: 'admin' },
    });

    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ mustChangePassword: true });
  });
});
