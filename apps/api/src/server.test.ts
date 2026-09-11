import { Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openTestDatabase } from '../test/open-test-database';

import type { SqliteDatabase } from './db/connection';
import { REDACTED_PATHS, buildServer } from './server';

/**
 * Logger redaction (N9, §5a "never log an attempted password").
 *
 * Fastify does not serialise request bodies by default, so none of these
 * paths can fire as the code stands today. That is exactly why the test
 * exists: the rule has to already be in place on the day somebody adds
 * `request.log.info({ body })` to debug a login. A redaction rule added
 * after that line is a rule added after the password reached the disk.
 */
describe('logger redaction', () => {
  let database: SqliteDatabase;
  let written: string[];

  beforeEach(() => {
    database = openTestDatabase();
    written = [];
  });

  afterEach(() => {
    database.close();
  });

  const captureLogs = async () => {
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        written.push(chunk.toString('utf8'));
        done();
      },
    });

    const app = await buildServer({
      database,
      sessionSecret: 'test-secret',
      logger: true,
    });

    // Rebuilding the logger against a capture stream is not possible after
    // construction, so assert on the configuration the server declares and
    // prove it works by feeding a pino instance the same options.
    const { pino } = await import('pino');
    const logger = pino(
      { redact: { paths: REDACTED_PATHS, censor: '[redacted]' } },
      sink,
    );

    return { app, logger };
  };

  it('redacts a password logged at the top level', async () => {
    const { app, logger } = await captureLogs();

    logger.info({ password: 'hunter2hunter2' }, 'login attempt');
    await app.close();

    expect(written.join('')).not.toContain('hunter2hunter2');
    expect(written.join('')).toContain('[redacted]');
  });

  it('redacts every credential field a change request carries', async () => {
    const { app, logger } = await captureLogs();

    logger.info({
      currentPassword: 'the-old-one',
      newPassword: 'the-new-one',
    });
    await app.close();

    const output = written.join('');
    expect(output).not.toContain('the-old-one');
    expect(output).not.toContain('the-new-one');
  });

  it('redacts a password nested under req.body', async () => {
    const { app, logger } = await captureLogs();

    logger.info({ req: { body: { password: 'hunter2hunter2' } } });
    await app.close();

    expect(written.join('')).not.toContain('hunter2hunter2');
  });

  it('redacts the stored hash, not only the plaintext', async () => {
    // A hash is not a password, but it is what an offline attack needs.
    const { app, logger } = await captureLogs();

    logger.info({ passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$abc$def' });
    await app.close();

    expect(written.join('')).not.toContain('$argon2id$');
  });

  it('redacts the cookie header, which carries the session id', async () => {
    const { app, logger } = await captureLogs();

    logger.info({ req: { headers: { cookie: 'payout_session=secret-id' } } });
    await app.close();

    expect(written.join('')).not.toContain('secret-id');
  });

  it('still logs everything else', async () => {
    const { app, logger } = await captureLogs();

    logger.info({ username: 'admin', password: 'x' }, 'sign-in');
    await app.close();

    // The username is not a secret; it is the only thing that makes a log
    // line about a sign-in worth having.
    expect(written.join('')).toContain('admin');
  });

  it('covers every field name the auth routes accept', () => {
    // If a route grows a new credential field, this list has to grow with it.
    for (const field of ['password', 'currentPassword', 'newPassword']) {
      expect(REDACTED_PATHS).toContain(field);
      expect(REDACTED_PATHS).toContain(`req.body.${field}`);
    }
  });
});
