import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openTestDatabase } from '../test/open-test-database';

import { replaceCurrencies } from './adapters/maintenance';
import { buildContainer } from './container';
import type { SqliteDatabase } from './db/connection';

const SRC = fileURLToPath(new URL('.', import.meta.url));

function everySourceFile(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return everySourceFile(full);
    }

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [full]
      : [];
  });
}

/** Relative to `apps/api/src`, with forward slashes, for readable failures. */
const relative = (file: string): string =>
  path.relative(SRC, file).replace(/\\/g, '/');

describe('buildContainer', () => {
  let database: SqliteDatabase;

  beforeEach(() => {
    database = openTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it('builds every use case the routes can reach for', () => {
    const container = buildContainer(database);

    // If a use case is missing from the container, the route that needs it
    // fails at runtime with `undefined is not a function` — after the guards
    // have run and a request is half way through. Better here.
    for (const [name, useCase] of Object.entries(container.useCases)) {
      expect(useCase, `useCases.${name}`).toBeDefined();
      expect(
        typeof (useCase as { execute?: unknown }).execute,
        `useCases.${name}.execute`,
      ).toBe('function');
    }
  });

  it('gives every use case a single execute method, per §3', () => {
    const container = buildContainer(database);

    for (const [name, useCase] of Object.entries(container.useCases)) {
      const methods = Object.getOwnPropertyNames(
        Object.getPrototypeOf(useCase) as object,
      ).filter((method) => method !== 'constructor');

      expect(methods, `useCases.${name}`).toEqual(['execute']);
    }
  });

  it('reads currency scales from the database, not from a constant', async () => {
    // §6: the scale lives in the `currencies` table. A container using the
    // hard-coded default registry would keep working against a database whose
    // scales differ, and be wrong by a factor of 10^n — silently.
    //
    // So: give INR three decimal places instead of two, and see which one the
    // use case believes.
    replaceCurrencies(database, [
      { code: 'INR', scale: 3, divisor: 1000, kind: 'fiat', symbol: '#' },
      { code: 'USD', scale: 2, divisor: 100, kind: 'fiat', symbol: '$' },
    ]);

    const container = buildContainer(database);
    const company = await container.useCases.recordCompany.execute({
      code: 'C',
      name: 'Company',
    });
    const payout = await container.useCases.recordPayout.execute({
      code: 'P',
      companyId: company.id,
      payoutDate: '2025-03-10',
      grossAmount: '1.000',
      currencyCode: 'INR',
    });

    // 1000 minor units, not 100. The database said so.
    expect(payout.gross.minor).toBe(1000n);
  });

  it('exposes the file source for streaming documents', () => {
    const container = buildContainer(database);

    expect(typeof container.documentFiles.openReadStream).toBe('function');
  });
});

/**
 * The dependency rule, checked rather than trusted.
 *
 * §5 says the container is the only file that knows about everything. The
 * ESLint rule already stops `packages/core` reaching outward; nothing stopped
 * a route from importing a repository directly, which would put SQL one
 * import away from a handler and make the ports decorative.
 */
describe('the container is the only bridge (§5)', () => {
  const files = everySourceFile(SRC);

  it('found the source tree, so the sweep really ran', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it('is the only file importing both a use case and an adapter', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const name = relative(file);

      if (name === 'container.ts') {
        continue;
      }

      // A runtime import of an adapter module. Type-only imports are fine:
      // they vanish at compile time and create no coupling.
      const importsAdapter =
        /^import\s+(?!type\s)[^;]*from\s+['"][^'"]*adapters\//m.test(source);

      // A runtime import of a use case class from core.
      const importsUseCase =
        /^import\s+(?!type\s)\{[^}]*\b(Record|List|Get|Attach|Search|Run|Generate|Sign|Change|Authenticate|Import)[A-Z][^}]*\}\s+from\s+['"]@payout\/core['"]/m.test(
          source,
        );

      if (importsAdapter && importsUseCase) {
        offenders.push(name);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps adapters out of the routes folder entirely', () => {
    const offenders = files
      .filter((file) => relative(file).startsWith('routes/'))
      .filter((file) =>
        /from\s+['"][^'"]*adapters\//.test(readFileSync(file, 'utf8')),
      )
      .map(relative);

    expect(offenders).toEqual([]);
  });

  it('keeps the database out of the routes folder', () => {
    // A route holding a `SqliteDatabase` could run a query, and §12 says SQL
    // lives in adapter files. The ESLint rule catches the SQL; this catches
    // the handle that would make it possible.
    const offenders = files
      .filter((file) => relative(file).startsWith('routes/'))
      .filter((file) =>
        /from\s+['"][^'"]*db\/connection['"]/.test(readFileSync(file, 'utf8')),
      )
      .map(relative);

    expect(offenders).toEqual([]);
  });

  it('never mounts a static file handler', () => {
    // Documents are served by `/api/documents/:id`, behind both guards. A
    // static mount on `data/files` would publish every stored file to anyone
    // who can guess a content-addressed path, with no session check and no
    // place to add one.
    const offenders = files
      .filter((file) =>
        /@fastify\/static|sendFile|root:\s*.*files/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map(relative);

    expect(offenders).toEqual([]);
  });
});
