import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vitest/config';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const normalise = (value: string): string => value.replace(/\\/g, '/');

const CORE_SRC = path.join(ROOT, 'packages', 'core', 'src');
const FAKE_WORLD = normalise(
  path.join(ROOT, 'packages', 'core', 'test', 'fakes', 'world.ts'),
);
const SQLITE_WORLD = path.join(ROOT, 'apps', 'api', 'test', 'sqlite-world.ts');

/**
 * Point `test/fakes/world` at the SQLite-backed world instead.
 *
 * The use-case suite imports one module to get its repositories. Redirecting
 * that single import is the whole of the contract run: the test files are not
 * edited, not parameterised, and not aware there are two worlds. If the ports
 * were describing something the fakes could do but SQLite could not, this is
 * where it would show up.
 */
function useSqliteWorld(): Plugin {
  return {
    name: 'payout:use-sqlite-world',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer === undefined || !source.includes('test/fakes/world')) {
        return null;
      }

      const resolved = normalise(path.resolve(path.dirname(importer), source));

      return resolved === FAKE_WORLD || `${resolved}.ts` === FAKE_WORLD
        ? SQLITE_WORLD
        : null;
    },
  };
}

export default defineConfig({
  resolve: {
    /**
     * Both spellings of core must land on the same files.
     *
     * `@payout/core` resolves through the workspace link to the package's
     * built `dist`, while `@core/*` points at `src`. Loading both gives two
     * copies of every class, and a Money built by one is unrecognisable to
     * the other — `#currency` belongs to a different class object. Under test
     * there is one core, and it is the source.
     */
    alias: [
      { find: /^@payout\/core$/, replacement: path.join(CORE_SRC, 'index.ts') },
      { find: /^@core\//, replacement: `${normalise(CORE_SRC)}/` },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/*/src/**/*.test.{ts,tsx}',
          ],
          environment: 'node',
        },
      },
      {
        extends: true,
        plugins: [useSqliteWorld()],
        test: {
          name: 'sqlite',
          // The Stage 5 use-case suite, verbatim, against real adapters.
          include: ['packages/core/src/usecases/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
    coverage: {
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**', 'apps/*/src/**'],
    },
  },
});
