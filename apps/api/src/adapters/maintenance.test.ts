import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { arrangeReferencePayout, reference } from '../../test/arrange';
import { openTestDatabase } from '../../test/open-test-database';
import type { SqliteDatabase } from '../db/connection';

import { loadCurrencyRegistry } from './currency-registry';
import { bulkLoad, countRows, snapshot } from './maintenance';

describe('loadCurrencyRegistry', () => {
  let database: SqliteDatabase;

  beforeEach(() => {
    database = openTestDatabase();
  });

  afterEach(() => {
    database.close();
  });

  it('takes the scales from the currencies table (CLAUDE.md §6)', () => {
    const currencies = loadCurrencyRegistry(database);

    expect(currencies.get('INR').scale).toBe(2);
    expect(currencies.get('USD').scale).toBe(2);
    expect(currencies.get('USDT').scale).toBe(8);
  });

  it('knows nothing the table does not say', () => {
    expect(() => loadCurrencyRegistry(database).get('GBP')).toThrow();
  });

  it('picks up a currency added by INSERT, with no code change', () => {
    database
      .prepare(
        'INSERT INTO currencies (code, scale, divisor, kind) VALUES (?, ?, ?, ?)',
      )
      .run('JPY', 0, 1, 'fiat');

    expect(loadCurrencyRegistry(database).get('JPY').scale).toBe(0);
  });
});

describe('bulkLoad and snapshot', () => {
  let database: SqliteDatabase;

  afterEach(() => {
    database.close();
  });

  it('loads the whole reference tree with its ids preserved', () => {
    const arranged = arrangeReferencePayout();
    database = arranged.database;

    const loaded = snapshot(database, arranged.currencies);

    expect(loaded.transactions).toHaveLength(13);
    expect(loaded.transactions.map((one) => one.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    expect(
      loaded.transactions.find((one) => one.code === 'Transaction0011')?.id,
    ).toBe(11);
  });

  it('accepts a child that appears before its parent in the batch', () => {
    // Transaction003 (a sale) names parent 7, which is inserted after it.
    // Only deferred foreign keys make that ordering survivable.
    const arranged = arrangeReferencePayout();
    database = arranged.database;

    const sale = snapshot(database, arranged.currencies).transactions.find(
      (one) => one.code === 'Transaction003',
    );

    expect(sale?.parentId).toBe(7);
  });

  it('still rejects a reference that points at nothing', () => {
    const arranged = arrangeReferencePayout();
    database = arranged.database;

    expect(() =>
      bulkLoad(database, {
        payouts: [reference.PAYOUT.withReference('x')],
      }),
    ).toThrow();
  });

  it('is all-or-nothing', () => {
    database = openTestDatabase();

    expect(() =>
      bulkLoad(database, {
        companies: [reference.TRADEIFY],
        // Accounts reference companies that exist, but this payout does not.
        payouts: [reference.PAYOUT],
        transactions: [...reference.TRANSACTIONS],
      }),
    ).toThrow();

    expect(countRows(database, 'companies')).toBe(0);
    expect(countRows(database, 'payouts')).toBe(0);
  });

  it('round-trips money through the database exactly', () => {
    const arranged = arrangeReferencePayout();
    database = arranged.database;

    const loaded = snapshot(database, arranged.currencies);
    const sale = loaded.transactions.find(
      (one) => one.code === 'Transaction0011',
    );

    expect(sale?.fromAmount.minor).toBe(74172000000n);
    expect(sale?.toAmount.minor).toBe(7288358n);
  });

  it('round-trips the account allow-lists', () => {
    const arranged = arrangeReferencePayout();
    database = arranged.database;

    const bank = snapshot(database, arranged.currencies).accounts.find(
      (one) => one.code === 'bank-hdfc',
    );

    expect(bank?.allowedCurrencies).toEqual(['INR']);
  });
});

describe('countRows', () => {
  let database: SqliteDatabase;

  afterEach(() => {
    database.close();
  });

  it('counts a populated table', () => {
    const arranged = arrangeReferencePayout();
    database = arranged.database;

    expect(countRows(database, 'transactions')).toBe(13);
    expect(countRows(database, 'transaction_fees')).toBe(16);
    expect(countRows(database, 'accounts')).toBe(5);
  });

  it('counts an empty table as zero, as a number', () => {
    database = openTestDatabase();

    expect(countRows(database, 'documents')).toBe(0);
    expect(typeof countRows(database, 'documents')).toBe('number');
  });

  it('counts the migrations that have been applied', () => {
    database = openTestDatabase();

    expect(countRows(database, 'schema_migrations')).toBe(2);
  });
});
