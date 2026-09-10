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

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'data/**'],
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

  prettier,
);
