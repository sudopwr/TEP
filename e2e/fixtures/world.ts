import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base, type Locator, type Page } from '@playwright/test';

import { buildContainer } from '../../apps/api/src/container';
import { openDatabase } from '../../apps/api/src/db/connection';
import { migrate } from '../../apps/api/src/db/migrate';
import { start, type StartedServer } from '../../apps/api/src/main';

/**
 * A whole application, from an empty directory, for one test.
 *
 * Everything is real: the migrations that ship, the importer that corrects
 * §9's defects, and the Fastify server started through `main.ts`'s own
 * `start` — serving the built interface itself, from one process on one
 * origin, which is exactly what `npm start` does. The only thing a test
 * supplies is where the data lives.
 *
 * One stand-in, and only since F29: the explorer a chain lookup reads. That
 * request is the single thing this application sends off the machine, and a
 * suite that really sent it would need somebody's API key and somebody
 * else's uptime.
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
const WEB_DIST = path.join(REPO, 'apps', 'web', 'dist');
const LEGACY_CSV = path.join(
  REPO,
  'apps',
  'api',
  'test',
  'fixtures',
  'tradeify-legacy.csv',
);

export interface World {
  /** Where the browser goes. The same origin the API answers on.  */
  readonly baseURL: string;
  /** The same address again, for the few assertions made without a browser. */
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
/**
 * The explorer, stood in for.
 *
 * F29 is the one feature that leaves the machine, and a suite that actually
 * left it would need an API key and somebody else's uptime. This answers in
 * the shape Etherscan's V2 proxy does, for any hash: a plain transfer from
 * `SENDER` to `RECIPIENT`.
 *
 * It listens on loopback and on a port the OS picks, like everything else
 * here, so two workers never collide.
 */
export const STUB_SENDER = '0x1111111111111111111111111111111111111111';
export const STUB_RECIPIENT = '0x2222222222222222222222222222222222222222';
/** The wallet that signed, and the contract it called — neither is the money. */
const STUB_SIGNER = '0xcbc1d3b66c60ece2bb4bbbf9ed81a37c85736027';
const STUB_TOKEN = '0xdac17f958d2ee523a2206206994597c13d831ec7';

async function startStubExplorer(): Promise<{
  readonly url: string;
  close(): Promise<void>;
}> {
  const word = (value: bigint): string =>
    `0x${value.toString(16).padStart(64, '0')}`;
  const topic = (address: string): string =>
    `0x${address.slice(2).padStart(64, '0')}`;

  const server = createServer((request, response) => {
    const url = request.url ?? '';
    const known = url.includes('txhash=0x');

    /*
      The four calls a lookup makes (F29, F30): the transaction, its
      receipt, and the token's `decimals()` and `symbol()`. The receipt
      carries one ERC-20 `Transfer` — 45.9571 USDT — which is the row a
      ledger actually wants.
    */
    const result = url.includes('eth_getTransactionByHash')
      ? known
        ? { from: STUB_SIGNER, to: STUB_TOKEN, value: '0x0' }
        : null
      : url.includes('eth_getTransactionReceipt')
        ? {
            logs: [
              {
                address: STUB_TOKEN,
                topics: [
                  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                  topic(STUB_SENDER),
                  topic(STUB_RECIPIENT),
                ],
                data: word(45_957_100n),
              },
            ],
          }
        : url.includes('data=0x313ce567')
          ? word(6n)
          : `0x${word(32n).slice(2)}${word(4n).slice(2)}${Buffer.from(
              'USDT',
            ).toString('hex').padEnd(64, '0')}`;

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the stub explorer did not get a port');
  }

  return {
    url: `http://127.0.0.1:${String(address.port)}/api`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

async function startWorld(): Promise<Running> {
  const directory = mkdtempSync(path.join(tmpdir(), 'payout-e2e-'));
  const databasePath = path.join(directory, 'app.db');
  const filesRoot = path.join(directory, 'files');

  const seeding = openDatabase(databasePath);
  try {
    migrate(seeding);
    const container = buildContainer(seeding, { filesRoot });

    /*
      Whose sheet this is (F24), resolved the way `npm run import` resolves
      it: the trader `004_traders.sql` created, who every payout already
      belonged to when payouts gained an owner.
    */
    const [trader] = await container.useCases.listTraders.execute();

    if (trader === undefined) {
      throw new Error('the migrations left no trader to import the sheet for');
    }

    await container.importLegacyCsv.execute({
      location: LEGACY_CSV,
      traderId: trader.id,
    });
  } finally {
    seeding.close();
  }

  /*
    Pointed at the stub through the environment, which is how an operator
    configures it too (`.env`). Set before `start`, restored after, so one
    world cannot leak its explorer into the next.
  */
  const explorer = await startStubExplorer();
  const previous = {
    key: process.env['ETHERSCAN_API_KEY'],
    api: process.env['PAYOUT_ETHERSCAN_API'],
  };
  process.env['ETHERSCAN_API_KEY'] = 'e2e-key-not-a-real-one';
  process.env['PAYOUT_ETHERSCAN_API'] = explorer.url;

  const api: StartedServer = await start({
    // 0 asks the OS for a free port, so a run collides with neither a dev
    // server nor another worker.
    port: 0,
    databasePath,
    filesRoot,
    // The built interface, served by this same process. `global-setup.ts`
    // builds it once for the whole run.
    webRoot: WEB_DIST,
    // Never the repository's own `.env`: a run must not rewrite the
    // developer's session secret, and a file of its own means every world
    // signs its cookies with a key nothing else knows.
    envFile: path.join(directory, '.env'),
    logger: false,
  });

  const world: World = {
    baseURL: api.address,
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
      await api.close();
      await explorer.close();

      restore('ETHERSCAN_API_KEY', previous.key);
      restore('PAYOUT_ETHERSCAN_API', previous.api);

      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Put an environment variable back, including back to absent. */
function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
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
/**
 * A labelled input, on the page or inside a dialog.
 *
 * `Page | Locator` because a dialog's fields have to be found *within* it:
 * the screen behind stays in the DOM, so ‘Name’ on the page would be
 * ambiguous the moment an edit dialog opens over a form.
 */
export function field(scope: Page | Locator, label: string): Locator {
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
  return scope.getByLabel(new RegExp(String.raw`^${label}\s*\*?$`));
}

/**
 * A select rendered by `TextField select`, which is a combobox.
 *
 * `Page | Locator` for the same reason as `field`: a dialog's selects have to
 * be found within it, or a screen with a ‘Kind’ of its own behind the dialog
 * makes the name ambiguous the moment one opens.
 */
export function choose(scope: Page | Locator, label: string): Locator {
  return scope.getByRole('combobox', { name: new RegExp(`^${label}`) });
}

export { expect } from '@playwright/test';
