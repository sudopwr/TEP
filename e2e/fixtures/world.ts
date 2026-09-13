import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base, type Locator, type Page } from '@playwright/test';
import { preview, type PreviewServer } from 'vite';

import { buildContainer } from '../../apps/api/src/container';
import { openDatabase } from '../../apps/api/src/db/connection';
import { migrate } from '../../apps/api/src/db/migrate';
import { start, type StartedServer } from '../../apps/api/src/main';

/**
 * A whole application, from an empty directory, for one test.
 *
 * Everything is real: the migrations that ship, the importer that corrects
 * §9's defects, the Fastify server started through `main.ts`'s own `start`,
 * and the built web app served by Vite with its proxy pointed at that server.
 * Nothing is stubbed, and the only thing a test supplies is where the data
 * lives.
 *
 * **Per test, not per worker.** Half of these journeys change the world — they
 * set a password, record a leg, upload a file — and the other half assert on
 * figures the first half would move. Sharing a database would make the suite
 * order-dependent, which is the failure mode where a test passes alone and
 * fails in CI and nobody can say why. A fresh database costs a migration and a
 * thirteen-row import, which is cheaper than that argument.
 *
 * **`start()`, not a hand-assembled server.** §5a's bootstrap order is
 * load-bearing — migrate, read the must-change flag, check the bind address,
 * *then* listen — and a test that assembled its own server would be exercising
 * an order that exists only in the test.
 */

export const DEFAULT_USERNAME = 'admin';
/** §5a's shipped credential. Every install starts here. */
export const DEFAULT_PASSWORD = 'admin';
/** What the first run changes it to. Twelve characters or more. */
export const CHANGED_PASSWORD = 'a quiet harbour lamp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const WEB = path.join(REPO, 'apps', 'web');
const LEGACY_CSV = path.join(
  REPO,
  'apps',
  'api',
  'test',
  'fixtures',
  'tradeify-legacy.csv',
);

export interface World {
  /** Where the browser goes: the web app, with `/api` proxied to the server. */
  readonly baseURL: string;
  /** The API's own origin, for asserting without a browser. */
  readonly apiURL: string;
  readonly databasePath: string;
  /** Sign in through the real form. Does not wait for what comes next. */
  signIn(page: Page, password?: string): Promise<void>;
}

type Flavour = 'shipped' | 'changed';

interface Running {
  readonly world: World;
  close(): Promise<void>;
}

/**
 * Migrate, import, listen, serve.
 *
 * The import is the one `npm run import` runs, through the same container — so
 * the database these tests read is the database the owner would have after
 * importing their sheet, corrections and all.
 */
async function startWorld(): Promise<Running> {
  const directory = mkdtempSync(path.join(tmpdir(), 'payout-e2e-'));
  const databasePath = path.join(directory, 'app.db');
  const filesRoot = path.join(directory, 'files');

  const seeding = openDatabase(databasePath);
  try {
    migrate(seeding);
    await buildContainer(seeding, { filesRoot }).importLegacyCsv.execute({
      location: LEGACY_CSV,
    });
  } finally {
    seeding.close();
  }

  const api: StartedServer = await start({
    // 0 asks the OS for a free port, so a run collides with neither a dev
    // server nor another worker.
    port: 0,
    databasePath,
    filesRoot,
    // Never the repository's own `.env`: a run must not rewrite the
    // developer's session secret, and a file of its own means every world
    // signs its cookies with a key nothing else knows.
    envFile: path.join(directory, '.env'),
    logger: false,
  });

  /*
    The built web app, served the way `vite preview` serves it — SPA fallback
    included, so `/payouts/1` typed into the address bar reaches the router
    rather than a 404. `global-setup.ts` builds it once for the whole run.
  */
  const web: PreviewServer = await preview({
    root: WEB,
    configFile: false,
    build: { outDir: 'dist' },
    preview: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      proxy: Object.fromEntries(
        ['/api', '/auth', '/health'].map((prefix) => [
          prefix,
          { target: api.address, changeOrigin: false },
        ]),
      ),
    },
    logLevel: 'silent',
  });

  const served = web.resolvedUrls?.local[0];
  if (served === undefined) {
    throw new Error(
      'the preview server started without an address — has apps/web been built?',
    );
  }

  const world: World = {
    baseURL: served.replace(/\/$/, ''),
    apiURL: api.address,
    databasePath,
    async signIn(page, password = CHANGED_PASSWORD) {
      await page.goto('/signin');
      await field(page, 'Username').fill(DEFAULT_USERNAME);
      await field(page, 'Password').fill(password);
      await page.getByRole('button', { name: 'Sign in' }).click();
    },
  };

  return {
    world,
    close: async () => {
      // Vite's own `close`, which drops keep-alive connections rather than
      // waiting for the browser to let go of them — `httpServer.close()`
      // alone would sit there until a socket timed out.
      await web.close();
      await api.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/**
 * Change the shipped password through the API, exactly as the screen does.
 *
 * Not by writing a hash into the database: UC13 is what clears the must-change
 * flag, and a world built by going round it would be a world no real install
 * can reach.
 */
async function changeThePassword(world: World): Promise<void> {
  const signedIn = await fetch(`${world.apiURL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: DEFAULT_USERNAME,
      password: DEFAULT_PASSWORD,
    }),
  });

  const cookie = signedIn.headers.get('set-cookie');
  if (!signedIn.ok || cookie === null) {
    throw new Error(`could not sign in to prepare the world: ${signedIn.status}`);
  }

  const changed = await fetch(`${world.apiURL}/auth/change-credentials`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      currentPassword: DEFAULT_PASSWORD,
      newPassword: CHANGED_PASSWORD,
    }),
  });

  if (!changed.ok) {
    throw new Error(`could not change the password: ${changed.status}`);
  }
}

/**
 * The world, and the `baseURL` that points the browser at it.
 *
 * `baseURL` is normally static configuration, and here it cannot be: each
 * world listens on whichever port the OS had free. Overriding Playwright's own
 * `baseURL` fixture — which `page` already depends on — means a test writes
 * `page.goto('/payouts')` and never mentions a port at all.
 */
const world = base.extend<{ flavour: Flavour; world: World }>({
  flavour: ['shipped', { option: true }],

  world: async ({ flavour }, use) => {
    const running = await startWorld();

    try {
      if (flavour === 'changed') {
        await changeThePassword(running.world);
      }
      await use(running.world);
    } finally {
      await running.close();
    }
  },

  baseURL: async ({ world: started }, use) => {
    await use(started.baseURL);
  },
});

/**
 * Two helpers, because F15 splits the application in half.
 *
 * `shippedPassword` is a first run: `admin` / `admin`, the must-change flag
 * set, every data route answering 403. `changedPassword` is every day after
 * that. A journey that wants one and is handed the other tests nothing, so
 * they are separate entry points rather than a flag inside the test — asking
 * for the wrong one is then visible on the import line.
 */
export const shippedPassword = world;

export const changedPassword = world.extend({ flavour: 'changed' });

/**
 * The field with this label, whether or not MUI has put an asterisk on it.
 *
 * A required `TextField` renders its label as `New password *`, so an exact
 * match finds nothing and a loose one on "New password" also catches "New
 * password again". Anchored, with the asterisk optional, hits exactly one
 * field and keeps working if the field stops being required.
 */
export function field(page: Page, label: string): Locator {
  /*
    Anchored, with a trailing asterisk that may or may not be there.

    MUI marks a required field by appending an `aria-hidden` span containing
    `*`. Which means the accessible name is plain "New password" — but the
    *label element's* text is "New password*", and Playwright will match a
    regex against either. Allowing both, anchored at the end, is what
    separates "New password" from "New password again".

    `String.raw` because `\*` in an ordinary template literal is just `*`,
    which would turn the asterisk into "any number of spaces" and match the
    wrong field without saying so. CLAUDE.md §13 records the same trap twice.
  */
  return page.getByLabel(new RegExp(String.raw`^${label}\s*\*?$`));
}

/** A select rendered by `TextField select`, which is a combobox. */
export function choose(page: Page, label: string): Locator {
  return page.getByRole('combobox', { name: new RegExp(`^${label}`) });
}

export { expect } from '@playwright/test';
