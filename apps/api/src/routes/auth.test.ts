import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTestServer,
  cookieFrom,
  type TestServer,
} from '../../test/build-test-server';

const NEW_PASSWORD = 'a quiet harbour lamp';

/** A route that is on neither exemption list, so both guards apply to it. */
const DATA_ROUTE = '/accounts/balances';

describe('auth routes', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await buildTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  const login = (username = 'admin', password = 'admin') =>
    server.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username, password },
    });

  const loggedIn = async () => {
    const response = await login();
    const cookie = cookieFrom(response);
    if (cookie === null) throw new Error('no session cookie issued');
    return cookie;
  };

  const changeCredentials = (cookie: string, payload: Record<string, string>) =>
    server.app.inject({
      method: 'POST',
      url: '/auth/change-credentials',
      headers: { cookie },
      payload,
    });

  describe('POST /auth/login', () => {
    it('signs in with the shipped admin / admin and reports the flag', async () => {
      const response = await login();

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        username: 'admin',
        mustChangePassword: true,
      });
    });

    it('sets an httpOnly, sameSite=lax, path=/ session cookie', async () => {
      const response = await login();
      const cookie = response.cookies.find(
        (one) => one.name === 'payout_session',
      );

      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
      expect(cookie?.path).toBe('/');
      // Loopback has no TLS; §11 records the condition for changing this.
      expect(cookie?.secure).toBeFalsy();
    });

    it('puts only the session id in the cookie, never the username', async () => {
      const response = await login();
      const raw = response.headers['set-cookie'];

      expect(String(raw)).not.toContain('admin');
    });

    it('never returns the password hash', async () => {
      const response = await login();

      expect(response.body).not.toContain('argon2');
      expect(response.body).not.toContain('passwordHash');
    });

    describe('failure', () => {
      it('rejects a wrong password with 401', async () => {
        const response = await login('admin', 'wrong');

        expect(response.statusCode).toBe(401);
      });

      it('rejects an unknown username with 401', async () => {
        const response = await login('nobody', 'wrong');

        expect(response.statusCode).toBe(401);
      });

      it('gives byte-identical responses for both', async () => {
        // §5a: "unknown username and wrong password give identical
        // responses". Not merely equivalent — identical.
        const wrongPassword = await login('admin', 'definitely-wrong');
        const unknownUser = await login('nobody-at-all', 'definitely-wrong');

        expect(wrongPassword.statusCode).toBe(unknownUser.statusCode);
        expect(wrongPassword.body).toBe(unknownUser.body);
        expect(wrongPassword.json()).toEqual(unknownUser.json());
      });

      it('issues no cookie on either failure', async () => {
        expect(cookieFrom(await login('admin', 'wrong'))).toBeNull();
        expect(cookieFrom(await login('nobody', 'wrong'))).toBeNull();
      });

      it('never echoes the attempted credential back', async () => {
        const response = await login('sudopwr', 'hunter2hunter2');

        expect(response.body).not.toContain('sudopwr');
        expect(response.body).not.toContain('hunter2');
      });

      it('rejects a malformed body with 400, before any hashing', async () => {
        const response = await server.app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { username: 'admin' },
        });

        expect(response.statusCode).toBe(400);
      });

      it('rejects an unexpected field rather than ignoring it', async () => {
        const response = await server.app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { username: 'admin', password: 'admin', userId: 1 },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe('rate limiting', () => {
      it('allows five attempts a minute and then stops', async () => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          expect((await login('admin', 'wrong')).statusCode).toBe(401);
        }

        const sixth = await login('admin', 'wrong');
        expect(sixth.statusCode).toBe(429);
      });

      it('limits the correct password too, so it is not a guess oracle', async () => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await login('admin', 'wrong');
        }

        expect((await login()).statusCode).toBe(429);
      });

      it('does not rate-limit anything but login', async () => {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const health = await server.app.inject({ url: '/health' });
          expect(health.statusCode).toBe(200);
        }
      });
    });
  });

  describe('the must-change cage (§5a, F15)', () => {
    it('403s a data route with a machine-readable code while the flag is set', async () => {
      const response = await server.app.inject({
        url: DATA_ROUTE,
        headers: { cookie: await loggedIn() },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        code: 'password_change_required',
      });
    });

    it('still allows /auth/me, so the UI can discover the flag', async () => {
      const response = await server.app.inject({
        url: '/auth/me',
        headers: { cookie: await loggedIn() },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        username: 'admin',
        mustChangePassword: true,
      });
    });

    it('still allows /auth/logout, so a person can leave', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { cookie: await loggedIn() },
      });

      expect(response.statusCode).toBe(204);
    });

    it('allows the change itself while the flag is set', async () => {
      const response = await changeCredentials(await loggedIn(), {
        currentPassword: 'admin',
        newPassword: NEW_PASSWORD,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ mustChangePassword: false });
    });

    it('opens the data route once the password has changed', async () => {
      const cookie = await loggedIn();

      const before = await server.app.inject({
        url: DATA_ROUTE,
        headers: { cookie },
      });
      expect(before.statusCode).toBe(403);

      await changeCredentials(cookie, {
        currentPassword: 'admin',
        newPassword: NEW_PASSWORD,
      });

      const after = await server.app.inject({
        url: DATA_ROUTE,
        headers: { cookie },
      });
      expect(after.statusCode).toBe(200);
      expect(after.json()).toHaveProperty('balances');
    });

    it('stops accepting the OLD password afterwards', async () => {
      await changeCredentials(await loggedIn(), {
        currentPassword: 'admin',
        newPassword: NEW_PASSWORD,
      });

      expect((await login('admin', 'admin')).statusCode).toBe(401);
      expect((await login('admin', NEW_PASSWORD)).statusCode).toBe(200);
    });

    it('does not open the cage on a username-only change', async () => {
      const cookie = await loggedIn();

      await changeCredentials(cookie, {
        currentPassword: 'admin',
        newUsername: 'kd',
      });

      const response = await server.app.inject({
        url: '/auth/me',
        headers: { cookie },
      });
      expect(response.json()).toEqual({
        username: 'kd',
        mustChangePassword: true,
      });
    });
  });

  describe('the session guard', () => {
    it('401s a data route with no cookie at all', async () => {
      const response = await server.app.inject({ url: DATA_ROUTE });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        code: 'authentication_required',
      });
    });

    it('401s a forged session id', async () => {
      const response = await server.app.inject({
        url: DATA_ROUTE,
        headers: { cookie: 'payout_session=totally-made-up' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('401s a correctly-shaped but unsigned cookie', async () => {
      // The signature is what stops a cookie being hand-written.
      const response = await server.app.inject({
        url: DATA_ROUTE,
        headers: { cookie: 'payout_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('401s an expired session', async () => {
      const cookie = await loggedIn();
      await changeCredentials(cookie, {
        currentPassword: 'admin',
        newPassword: NEW_PASSWORD,
      });

      server.clock.advanceDays(31);

      const response = await server.app.inject({
        url: DATA_ROUTE,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(401);
    });

    it('401s a revoked session', async () => {
      const cookie = await loggedIn();
      await changeCredentials(cookie, {
        currentPassword: 'admin',
        newPassword: NEW_PASSWORD,
      });

      await server.app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { cookie },
      });

      const response = await server.app.inject({
        url: DATA_ROUTE,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(401);
    });

    it('gives the same response for forged, expired and revoked', async () => {
      const forged = await server.app.inject({
        url: DATA_ROUTE,
        headers: { cookie: 'payout_session=made-up' },
      });
      const none = await server.app.inject({ url: DATA_ROUTE });

      expect(forged.statusCode).toBe(none.statusCode);
      expect(forged.json()).toEqual(none.json());
    });

    it('clears the cookie on a 401, so the browser stops re-presenting it', async () => {
      const response = await server.app.inject({
        url: DATA_ROUTE,
        headers: { cookie: 'payout_session=made-up' },
      });

      expect(String(response.headers['set-cookie'])).toContain(
        'payout_session=',
      );
    });

    it('leaves /health open, because a liveness check needs no credential', async () => {
      const response = await server.app.inject({ url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });

    it('guards a route nobody exempted — the default is closed', async () => {
      // Registered after the guards, with no opt-in of any kind.
      server.app.get('/some/new/route', () => ({ secret: true }));
      await server.app.ready();

      const response = await server.app.inject({ url: '/some/new/route' });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /auth/change-credentials', () => {
    it('rejects a wrong current password with 401', async () => {
      const response = await changeCredentials(await loggedIn(), {
        currentPassword: 'not the password',
        newPassword: NEW_PASSWORD,
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects a new password under twelve characters', async () => {
      const response = await changeCredentials(await loggedIn(), {
        currentPassword: 'admin',
        newPassword: 'elevenchars',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'password_policy',
        violations: ['too_short'],
      });
    });

    it('rejects a new password equal to the username', async () => {
      const response = await changeCredentials(await loggedIn(), {
        currentPassword: 'admin',
        newUsername: 'harbourmaster',
        newPassword: 'harbourmaster',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().violations).toContain('same_as_username');
    });

    it('rejects a new password equal to the current one', async () => {
      const response = await changeCredentials(await loggedIn(), {
        currentPassword: 'admin',
        newPassword: 'admin',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().violations).toContain('same_as_current');
    });

    it('never echoes the rejected password', async () => {
      const response = await changeCredentials(await loggedIn(), {
        currentPassword: 'admin',
        newPassword: 'hunter2',
      });

      expect(response.body).not.toContain('hunter2');
    });

    it('401s without a session', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/auth/change-credentials',
        payload: { currentPassword: 'admin', newPassword: NEW_PASSWORD },
      });

      expect(response.statusCode).toBe(401);
    });

    it('invalidates a session created earlier, sparing the current one', async () => {
      const older = await loggedIn();
      const current = await loggedIn();

      const changed = await changeCredentials(current, {
        currentPassword: 'admin',
        newPassword: NEW_PASSWORD,
      });
      expect(changed.json()).toMatchObject({ otherSessionsRevoked: 1 });

      const withOld = await server.app.inject({
        url: DATA_ROUTE,
        headers: { cookie: older },
      });
      const withCurrent = await server.app.inject({
        url: DATA_ROUTE,
        headers: { cookie: current },
      });

      expect(withOld.statusCode).toBe(401);
      expect(withCurrent.statusCode).toBe(200);
    });

    it('changes the username and signs in under it', async () => {
      await changeCredentials(await loggedIn(), {
        currentPassword: 'admin',
        newUsername: 'kd',
        newPassword: NEW_PASSWORD,
      });

      const response = await login('kd', NEW_PASSWORD);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        username: 'kd',
        mustChangePassword: false,
      });
    });

    it('rejects an unknown field rather than silently ignoring it', async () => {
      // A typo'd `newPasword` must not report success having changed nothing.
      const response = await changeCredentials(await loggedIn(), {
        currentPassword: 'admin',
        newPasword: NEW_PASSWORD,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /auth/me', () => {
    it('401s with no session', async () => {
      const response = await server.app.inject({ url: '/auth/me' });

      expect(response.statusCode).toBe(401);
    });

    it('never includes the hash', async () => {
      const response = await server.app.inject({
        url: '/auth/me',
        headers: { cookie: await loggedIn() },
      });

      expect(response.body).not.toContain('argon2');
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the session server-side', async () => {
      const cookie = await loggedIn();
      await changeCredentials(cookie, {
        currentPassword: 'admin',
        newPassword: NEW_PASSWORD,
      });

      await server.app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { cookie },
      });

      const response = await server.app.inject({
        url: DATA_ROUTE,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(401);
    });

    it('is idempotent', async () => {
      const cookie = await loggedIn();

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await server.app.inject({
          method: 'POST',
          url: '/auth/logout',
          headers: { cookie },
        });
        expect(response.statusCode).toBe(204);
      }
    });

    it('succeeds with no cookie at all', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/auth/logout',
      });

      expect(response.statusCode).toBe(204);
    });

    it('clears the cookie', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { cookie: await loggedIn() },
      });

      expect(String(response.headers['set-cookie'])).toContain(
        'payout_session=;',
      );
    });
  });
});
