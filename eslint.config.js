import path from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * The dependency rule, mechanised.
 *
 * packages/core has zero runtime dependencies and knows nothing about the
 * outside world. That means every import inside it must be relative AND
 * must resolve to somewhere inside packages/core/src. A bare specifier
 * ('fastify', 'react', 'node:crypto') fails. So does a relative import
 * that climbs out ('../../../apps/api/db').
 *
 * This is the single rule from the architecture note: an import in
 * packages/core that names anything outside packages/core is a violation.
 */
const boundaries = {
  rules: {
    'core-is-self-contained': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'packages/core must not import anything outside packages/core/src',
        },
        schema: [
          {
            type: 'object',
            properties: {
              allow: { type: 'array', items: { type: 'string' } },
              root: { type: 'string' },
            },
            additionalProperties: false,
          },
        ],
        messages: {
          bare:
            "packages/core has zero dependencies, so '{{source}}' cannot be imported here. " +
            'Define a port in core/ports and implement it in apps/api.',
          escapes:
            "'{{source}}' resolves outside packages/core/src. " +
            'Dependencies point inward only — core may not reach out.',
        },
      },
      create(context) {
        const dir = path.dirname(context.filename);
        const allow = new Set(context.options[0]?.allow ?? []);
        const boundary = path.join(
          ROOT,
          ...(context.options[0]?.root ?? 'packages/core/src').split('/'),
        );

        const check = (node, source) => {
          if (typeof source !== 'string' || source.length === 0) return;
          if (allow.has(source)) return;

          if (!source.startsWith('./') && !source.startsWith('../')) {
            context.report({ node, messageId: 'bare', data: { source } });
            return;
          }

          const resolved = path.resolve(dir, source);
          if (
            resolved !== boundary &&
            !resolved.startsWith(boundary + path.sep)
          ) {
            context.report({ node, messageId: 'escapes', data: { source } });
          }
        };

        return {
          ImportDeclaration: (node) => check(node, node.source.value),
          ExportAllDeclaration: (node) => check(node, node.source.value),
          ExportNamedDeclaration: (node) => {
            if (node.source) check(node, node.source.value);
          },
          ImportExpression: (node) => {
            if (node.source.type === 'Literal') check(node, node.source.value);
          },
          'CallExpression[callee.name="require"]': (node) => {
            const [arg] = node.arguments;
            if (arg && arg.type === 'Literal') check(node, arg.value);
          },
        };
      },
    },
  },
};

/**
 * SQL belongs to the adapter layer.
 *
 * CLAUDE.md §12: "SQL lives in adapter files, never in routes or use cases."
 * The shapes below need two keywords to match, so a UI string like "select a
 * company" is not a false positive while `SELECT ... FROM` is.
 *
 * Two directories are exempt and no others: `adapters/`, which is the rule's
 * subject, and `db/`, where the migration runner creates the one table it
 * needs to track migrations and its test writes throwaway schemas.
 */
const SQL_SHAPES = [
  /\bSELECT\b[\s\S]*\bFROM\b/i,
  /\bINSERT\s+(OR\s+\w+\s+)?INTO\b/i,
  /\bUPDATE\b[\s\S]*\bSET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bCREATE\s+(TEMP\s+|TEMPORARY\s+|VIRTUAL\s+)?(TABLE|VIEW|INDEX|TRIGGER)\b/i,
  /\bALTER\s+TABLE\b/i,
  /\bDROP\s+(TABLE|VIEW|INDEX|TRIGGER)\b/i,
];

/** #rgb / #rrggbb / #rrggbbaa, and the CSS colour functions. */
const COLOUR = /#[0-9a-fA-F]{3,8}|(rgba?|hsla?|oklch|lab|color)\s*\(/;

const sqlBoundary = {
  rules: {
    'sql-stays-in-adapters': {
      meta: {
        type: 'problem',
        docs: { description: 'SQL may only appear in the adapter layer' },
        schema: [],
        messages: {
          stray:
            'SQL outside the adapter layer. Move the query into ' +
            'apps/api/src/adapters and call it through a port.',
        },
      },
      create(context) {
        const check = (node, text) => {
          if (
            typeof text === 'string' &&
            SQL_SHAPES.some((s) => s.test(text))
          ) {
            context.report({ node, messageId: 'stray' });
          }
        };

        return {
          Literal: (node) => check(node, node.value),
          TemplateElement: (node) => check(node, node.value.raw),
        };
      },
    },
  },
};

/**
 * The palette, mechanised.
 *
 * A design system that lives in a document is a suggestion; one that fails the
 * build is a design system. Exactly one file under apps/web may contain a
 * `#rrggbb`, and it is `shared/theme/palette.ts` — everything else asks the
 * theme for a meaning (`negative.main`) rather than for a colour.
 *
 * The point is not tidiness. A hex pasted into a component is a colour nobody
 * can find later, that no longer answers to the palette, and that quietly
 * breaks the one rule this interface depends on: if a pixel is coloured, it
 * means something.
 */
const design = {
  rules: {
    'no-raw-hex': {
      meta: {
        type: 'problem',
        docs: { description: 'Colours come from the theme, never from a hex' },
        schema: [],
        messages: {
          hex: "Raw colour '{{value}}'. Ask the theme for a meaning instead, as in color: 'negative.main' — or add it to shared/theme/palette.ts if it is genuinely part of the palette.",
        },
      },
      create(context) {
        const check = (node, text) => {
          if (typeof text !== 'string') return;

          const found = COLOUR.exec(text);
          if (found === null) return;

          context.report({ node, messageId: 'hex', data: { value: found[0] } });
        };

        return {
          Literal: (node) => check(node, node.value),
          TemplateElement: (node) => check(node, node.value.raw),
        };
      },
    },
  },
};

/**
 * N8, mechanised: "UI components are independent and reusable — no feature
 * imports another feature's components."
 *
 * Two rules, both aimed at the same failure. A shared component that reaches
 * into `features/` is no longer shared; one that fetches cannot be rendered
 * without a server, cannot be reused on a second screen, and has quietly
 * become a feature with a misleading address.
 */
/** The feature directory a path sits in, or null if it is outside them. */
function featureOf(file, featuresRoot) {
  const relative = path.relative(featuresRoot, file);

  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;

  const [feature] = relative.split(path.sep);
  return feature === undefined || feature === '' ? null : feature;
}

const shared = {
  rules: {
    'no-feature-imports': {
      meta: {
        type: 'problem',
        docs: { description: 'shared/ may not import from features/' },
        schema: [],
        messages: {
          leak:
            "'{{source}}' reaches into features/. Anything in shared/ must work " +
            'on a screen that does not exist yet — take what it needs as a prop.',
        },
      },
      create(context) {
        const check = (node, source) => {
          if (typeof source === 'string' && /(^|\/)features\//.test(source)) {
            context.report({ node, messageId: 'leak', data: { source } });
          }
        };

        return {
          ImportDeclaration: (node) => check(node, node.source.value),
          ImportExpression: (node) => {
            if (node.source.type === 'Literal') check(node, node.source.value);
          },
        };
      },
    },

    /**
     * N8's other half: "no feature imports another feature's components."
     *
     * Resolved against the filesystem rather than matched as a glob. A glob
     * broad enough to catch `../other-feature/Thing` also catches
     * `../../shared/components/MoneyDisplay`, which is the import features
     * are supposed to use — so the rule would fire on correct code and get
     * switched off within a week.
     */
    'no-cross-feature-imports': {
      meta: {
        type: 'problem',
        docs: { description: 'a feature may not import another feature' },
        schema: [],
        messages: {
          crossed:
            "'{{source}}' belongs to the '{{other}}' feature. Promote what is " +
            'shared into shared/components rather than reaching sideways.',
        },
      },
      create(context) {
        const FEATURES = path.join(ROOT, 'apps', 'web', 'src', 'features');
        const own = featureOf(context.filename, FEATURES);

        if (own === null) return {};

        return {
          ImportDeclaration: (node) => {
            const source = node.source.value;
            if (typeof source !== 'string' || !source.startsWith('.')) return;

            const resolved = path.resolve(
              path.dirname(context.filename),
              source,
            );
            const other = featureOf(resolved, FEATURES);

            if (other !== null && other !== own) {
              context.report({
                node,
                messageId: 'crossed',
                data: { source, other },
              });
            }
          },
        };
      },
    },

    'no-fetch-in-shared': {
      meta: {
        type: 'problem',
        docs: { description: 'shared components do not talk to the network' },
        schema: [],
        messages: {
          fetches:
            'A shared component must not call the network. Take the data as a ' +
            'prop and let a feature do the fetching.',
        },
      },
      create(context) {
        const NETWORK = new Set(['fetch', 'XMLHttpRequest', 'EventSource']);

        return {
          'CallExpression > Identifier': (node) => {
            if (NETWORK.has(node.name)) {
              context.report({ node, messageId: 'fetches' });
            }
          },
          'NewExpression > Identifier': (node) => {
            if (NETWORK.has(node.name)) {
              context.report({ node, messageId: 'fetches' });
            }
          },
          ImportDeclaration: (node) => {
            if (
              typeof node.source.value === 'string' &&
              /shared\/api/.test(node.source.value)
            ) {
              context.report({ node, messageId: 'fetches' });
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      // tsc's declaration output for apps/web. Generated, and linting it
      // reports the compiler's own style choices as if they were ours.
      '**/.tsbuild/**',
      '**/coverage/**',
      'data/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // No default exports anywhere except React components (CLAUDE.md §12).
  {
    files: ['packages/**/*.ts', 'apps/api/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'No default exports except React components.',
        },
      ],
    },
  },

  // The boundary. Build-breaking, by design. Shipped code only.
  {
    files: ['packages/core/src/**/*.ts'],
    ignores: ['packages/core/src/**/*.test.ts'],
    plugins: { boundaries },
    rules: {
      'boundaries/core-is-self-contained': 'error',
    },
  },

  // Core's own tests get exactly one exemption — the test runner, which is a
  // devDependency and never ships — and may reach the test doubles under
  // packages/core/test. Everything else is still walled off: a test may not
  // reach for fastify, sqlite, or anything under apps/.
  {
    files: ['packages/core/src/**/*.test.ts'],
    plugins: { boundaries },
    rules: {
      'boundaries/core-is-self-contained': [
        'error',
        { root: 'packages/core', allow: ['vitest'] },
      ],
    },
  },

  // Test doubles under packages/core/test are still inside the package, so
  // they may reach into src. They stand in for adapters, so they get the one
  // thing an adapter has and core does not: a hash function. Nothing else —
  // a fake still cannot import fastify, sqlite, or anything under apps/.
  {
    files: ['packages/core/test/**/*.ts'],
    plugins: { boundaries },
    rules: {
      'boundaries/core-is-self-contained': [
        'error',
        { root: 'packages/core', allow: ['vitest', 'node:crypto'] },
      ],
    },
  },

  // N8. shared/ is reusable or it is not shared. `shared/api` is the one
  // place allowed to touch the network, so it is exempt from the second rule.
  {
    files: ['apps/web/src/shared/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/shared/api/**'],
    plugins: { shared },
    rules: {
      'shared/no-feature-imports': 'error',
      'shared/no-fetch-in-shared': 'error',
    },
  },

  // A feature may not import another feature's components (N8).
  {
    files: ['apps/web/src/features/**/*.{ts,tsx}'],
    plugins: { shared },
    rules: {
      'shared/no-cross-feature-imports': 'error',
    },
  },

  // Colours come from the theme. One file is allowed to know a hex; the rest
  // of the interface asks for a meaning. Tests are included on purpose — a
  // test asserting on `#A3341F` is a second place the palette lives.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/shared/theme/palette.ts'],
    plugins: { design },
    rules: {
      'design/no-raw-hex': 'error',
    },
  },

  // SQL stays in the adapter layer.
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.ts'],
    ignores: ['apps/api/src/adapters/**', 'apps/api/src/db/**'],
    plugins: { sql: sqlBoundary },
    rules: {
      'sql/sql-stays-in-adapters': 'error',
    },
  },

  prettier,
);
