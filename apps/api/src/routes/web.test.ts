import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  asUser,
  authenticate,
  buildTestServer,
  seedReferencePayout,
  type TestServer,
} from '../../test/build-test-server';

import { isApiPath } from './web';

/**
 * The interface, served by the API (F-none: this is N5, "one command").
 *
 * Two things have to hold at once and they pull against each other. The
 * browser has to be able to load the screens before anybody has signed in —
 * otherwise the sign-in screen itself is behind the sign-in guard. And the
 * data routes have to stay shut. The tests below are the seam between those.
 */

/** A `dist` with just enough in it to be recognisably a built app. */
function buildAFakeApp(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'payout-web-'));

  mkdirSync(path.join(root, 'assets'));
  writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><title>Payout tracker</title><div id="root"></div>',
  );
  writeFileSync(
    path.join(root, 'assets', 'index-abc123.js'),
    'console.log("the bundle");',
  );

  return root;
}

describe('isApiPath', () => {
  it('claims the three prefixes the API owns', () => {
    for (const url of [
      '/api',
      '/api/payouts',
      '/api/payouts/1/trail?x=1',
      '/auth/me',
      '/health',
    ]) {
      expect(isApiPath(url), url).toBe(true);
    }
  });

  it('claims nothing else, including addresses that merely start alike', () => {
    // `/apiary` is a client-side route somebody could plausibly add, and it is
    // not the API. Prefix matching on the string alone would swallow it.
    for (const url of ['/', '/payouts', '/payouts/1', '/apiary', '/authors']) {
      expect(isApiPath(url), url).toBe(false);
    }
  });
});

describe('serving the interface', () => {
  let server: TestServer;
  let root: string;

  beforeEach(async () => {
    root = buildAFakeApp();
    server = await buildTestServer({ seed: seedReferencePayout, webRoot: root });
  });

  afterEach(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe('before anybody has signed in', () => {
    it('serves the page, or nobody could ever sign in', async () => {
      const response = await server.app.inject({ url: '/' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('Payout tracker');
    });

    it('serves the bundle', async () => {
      const response = await server.app.inject({
        url: '/assets/index-abc123.js',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('the bundle');
    });

    it('answers a client-side route with the page, not a 404', async () => {
      // `/payouts/1` is an address the browser knows and the server does not.
      const response = await server.app.inject({ url: '/payouts/1' });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('<div id="root">');
    });

    it('still refuses the data routes', async () => {
      const response = await server.app.inject({ url: '/api/payouts' });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        code: 'authentication_required',
      });
    });
  });

  describe('the fallback does not swallow the API', () => {
    let cookie: string;

    beforeEach(async () => {
      cookie = await authenticate(server);
    });

    it('404s an unknown /api path as JSON', async () => {
      // The failure this prevents: a client asking for JSON receives a page of
      // HTML with a 200 on it, and reports the typo as a parse error three
      // layers away from where it happened.
      const response = await asUser(server, cookie, { url: '/api/payout' });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.json()).toMatchObject({ code: 'not_found' });
    });

    it('404s an unknown /auth path as JSON', async () => {
      const response = await asUser(server, cookie, { url: '/auth/whoami' });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'not_found' });
    });

    it('404s a POST to an address that is not a route', async () => {
      // Only a GET can be a client-side route. A write to nowhere is a 404,
      // never a page.
      const response = await asUser(server, cookie, {
        method: 'POST',
        url: '/payouts/1',
        payload: {},
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'not_found' });
    });

    it('still answers the real API routes', async () => {
      const response = await asUser(server, cookie, { url: '/api/payouts' });

      expect(response.statusCode).toBe(200);
      expect(response.json().payouts).toHaveLength(1);
    });

    it('still streams a document through its handler', async () => {
      // §13: documents are served by a handler, never a static mount. Adding
      // one for the bundle must not have quietly created a second path to
      // them.
      const response = await server.app.inject({
        url: '/api/documents/1',
        headers: { cookie },
      });

      expect([200, 404]).toContain(response.statusCode);
      expect(response.headers['content-type']).not.toContain('text/html');
    });
  });

  describe('while the shipped password is still in place', () => {
    it('serves the interface, because the change screen is in it', async () => {
      // F15 shuts every data route. It must not shut the screens, or the cage
      // has no door.
      const fresh = await buildTestServer({ webRoot: root });

      try {
        const login = await fresh.app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { username: 'admin', password: 'admin' },
        });
        const session = login.headers['set-cookie'] as string;

        const page = await fresh.app.inject({
          url: '/change-password',
          headers: { cookie: session },
        });
        expect(page.statusCode).toBe(200);
        expect(page.body).toContain('<div id="root">');

        // And the data routes are still 403.
        const data = await fresh.app.inject({
          url: '/api/payouts',
          headers: { cookie: session },
        });
        expect(data.statusCode).toBe(403);
      } finally {
        await fresh.close();
      }
    });
  });
});

describe('with no interface built', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await buildTestServer({ seed: seedReferencePayout });
  });

  afterEach(async () => {
    await server.close();
  });

  it('is an API and nothing else, with the JSON 404 intact', async () => {
    // What `npm run dev` runs: Vite is serving the interface, so this process
    // has no business pretending to.
    const response = await server.app.inject({ url: '/payouts/1' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'not_found' });
  });
});
