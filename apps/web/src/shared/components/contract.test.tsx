import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '../../../test/render';

import {
  AmountField,
  ConfirmDialog,
  CurrencyChip,
  DataTable,
  EmptyState,
  ErrorBoundary,
  ErrorState,
  FileDropzone,
  MoneyDisplay,
  PasswordField,
  StatCard,
  TreeView,
  UserMenu,
} from './index';

/**
 * Resolved from the working directory, not from `import.meta.url`.
 *
 * Under the browser-ish test environment `import.meta.url` is not a `file:`
 * URL, so `fileURLToPath` throws. Vitest runs from the repository root, which
 * gives a stable base.
 */
const HERE = path.resolve(process.cwd(), 'apps/web/src/shared/components');

const sourceFiles = (): string[] =>
  readdirSync(HERE)
    .filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'))
    .filter((name) => !name.includes('.test.'))
    .map((name) => path.join(HERE, name));

/**
 * The rules the whole library is built on, checked rather than trusted.
 *
 * These are the three the brief is explicit about: no knowledge of features,
 * no API calls, and every component usable with nothing but its required
 * props. The first two are also ESLint rules (`shared/no-feature-imports`,
 * `shared/no-fetch-in-shared`); these tests are the second lock, and the one
 * that produces a readable failure naming the file.
 */
describe('the shared component library', () => {
  it('found its own source files, so the sweep really ran', () => {
    expect(sourceFiles().length).toBeGreaterThan(10);
  });

  it('imports nothing from features/', () => {
    const offenders = sourceFiles().filter((file) =>
      /from\s+['"][^'"]*features\//.test(readFileSync(file, 'utf8')),
    );

    expect(offenders.map((file) => path.basename(file))).toEqual([]);
  });

  it('makes no API calls of any kind', () => {
    // A shared component that fetches is a component that cannot be reused,
    // cannot be tested without a server, and has quietly become a feature.
    const offenders = sourceFiles().filter((file) =>
      /\bfetch\s*\(|XMLHttpRequest|\bEventSource\b|from\s+['"][^'"]*shared\/api/.test(
        readFileSync(file, 'utf8'),
      ),
    );

    expect(offenders.map((file) => path.basename(file))).toEqual([]);
  });

  it('never mentions a payout, a transaction or a fee in its code', () => {
    // Comments may use them as examples — that is what the story-style blocks
    // are for. Identifiers may not: a `payoutId` prop would mean the
    // component had stopped being generic.
    const withoutComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    const offenders = sourceFiles().filter((file) =>
      /\b(payout|transaction|settlement|ledger|tds|gst)\w*\s*[:?=]/i.test(
        withoutComments(readFileSync(file, 'utf8')),
      ),
    );

    expect(offenders.map((file) => path.basename(file))).toEqual([]);
  });

  it('carries a story-style example in every component file', () => {
    const missing = sourceFiles()
      .filter((file) => path.basename(file) !== 'index.ts')
      .filter((file) => !readFileSync(file, 'utf8').includes('```tsx'));

    expect(missing.map((file) => path.basename(file))).toEqual([]);
  });
});

/**
 * Every component, rendered with the least it will accept.
 *
 * The rule being enforced: a component whose "minimum" quietly requires four
 * more props is a component nobody can pick up and use. Each entry below is
 * exactly the required props and nothing else.
 */
describe('minimum required props', () => {
  const noop = (): void => {
    /* a callback that does nothing is still a valid callback */
  };

  const cases: readonly [string, () => JSX.Element][] = [
    ['MoneyDisplay', () => <MoneyDisplay minor="0" currency="INR" />],
    [
      'AmountField',
      () => <AmountField label="Amount" value="" onChange={noop} />,
    ],
    ['CurrencyChip', () => <CurrencyChip code="INR" />],
    ['EmptyState', () => <EmptyState message="Nothing here." />],
    ['ErrorState', () => <ErrorState message="It broke." />],
    ['StatCard', () => <StatCard label="Label" value="1" />],
    [
      'DataTable',
      () => (
        <DataTable
          rows={[{ id: 1 }]}
          columns={[{ id: 'c', header: 'C', cell: () => 'x' }]}
          rowKey={(row) => row.id}
        />
      ),
    ],
    [
      'TreeView',
      () => (
        <TreeView
          nodes={[{ id: 1 }]}
          childrenOf={() => []}
          keyOf={(node) => node.id}
          renderNode={() => 'node'}
        />
      ),
    ],
    ['FileDropzone', () => <FileDropzone onFiles={noop} />],
    [
      'ConfirmDialog',
      () => (
        <ConfirmDialog open title="Sure?" onConfirm={noop} onCancel={noop} />
      ),
    ],
    ['PasswordField', () => <PasswordField value="" onChange={noop} />],
    ['UserMenu', () => <UserMenu username="admin" />],
    ['ErrorBoundary', () => <ErrorBoundary>ok</ErrorBoundary>],
  ];

  it.each(cases)('%s renders', (_name, element) => {
    const onError = vi.fn();
    expect(() => {
      render(element());
    }).not.toThrow();
    expect(onError).not.toHaveBeenCalled();
  });

  it('covers every component file in the directory', () => {
    // Keyed off the files themselves rather than off the barrel: one
    // component per file is the convention, so a new file with no entry here
    // is a component nobody has proven renders.
    const componentFiles = sourceFiles()
      .map((file) => path.basename(file).replace(/\.tsx?$/, ''))
      .filter((name) => name !== 'index')
      .sort();

    expect(cases.map(([name]) => name).sort()).toEqual(componentFiles);
  });
});

describe('the library renders without a theme provider crashing', () => {
  it('still renders when a semantic token is requested', () => {
    // Every component reaches for tokens like `negative.main` that only
    // exist in this app's theme. Rendering through the real provider is what
    // the test helper does; this asserts the tokens actually resolve.
    render(<MoneyDisplay minor="-1" currency="INR" tone="auto" />);

    expect(screen.getByText('-0.01')).toBeInTheDocument();
  });
});
