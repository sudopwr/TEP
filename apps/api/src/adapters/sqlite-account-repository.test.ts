import { INR, USDT } from '@payout/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openTestDatabase } from '../../test/open-test-database';
import type { SqliteDatabase } from '../db/connection';

import { SqliteAccountRepository } from './sqlite-account-repository';

describe('SqliteAccountRepository', () => {
  let database: SqliteDatabase;
  let repository: SqliteAccountRepository;

  beforeEach(() => {
    database = openTestDatabase();
    repository = new SqliteAccountRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  const exchange = {
    code: 'coindcx',
    name: 'CoinDCX',
    type: 'exchange' as const,
    companyId: null,
    allowedCurrencies: ['USDT', 'INR'],
  };

  const bank = {
    code: 'bank-hdfc',
    name: 'HDFC',
    type: 'bank' as const,
    companyId: null,
    allowedCurrencies: ['INR'],
  };

  it('stores the allow-list in its own table and reads it back', async () => {
    const account = await repository.insert(exchange);

    expect(account.allowedCurrencies).toEqual(['INR', 'USDT']);
    expect(account.allows('USDT')).toBe(true);
    expect(account.allows('USD')).toBe(false);
  });

  it('round-trips through findById and findByCode', async () => {
    const inserted = await repository.insert(exchange);

    await expect(repository.findById(inserted.id)).resolves.toEqual(inserted);
    await expect(repository.findByCode('coindcx')).resolves.toEqual(inserted);
  });

  it('keeps an empty allow-list empty, meaning multi-currency', async () => {
    const account = await repository.insert({
      ...exchange,
      code: 'scratch',
      allowedCurrencies: [],
    });

    expect(account.allowedCurrencies).toEqual([]);
    expect(account.allows('GBP')).toBe(true);
  });

  it('hydrates every allow-list when listing, not just the first', async () => {
    await repository.insert(exchange);
    await repository.insert(bank);

    const listed = await repository.list();

    expect(listed.map((one) => one.allowedCurrencies)).toEqual([
      ['INR', 'USDT'],
      ['INR'],
    ]);
  });

  it('filters by type', async () => {
    await repository.insert(exchange);
    await repository.insert(bank);

    const banks = await repository.listByType('bank');

    expect(banks.map((one) => one.code)).toEqual(['bank-hdfc']);
    expect(banks[0]?.isBank()).toBe(true);
  });

  it('replaces the allow-list on update rather than appending to it', async () => {
    const account = await repository.insert(bank);

    const widened = await repository.update(account.allowCurrency('USD'));

    expect(widened.allowedCurrencies).toEqual(['INR', 'USD']);
    await expect(repository.findById(account.id)).resolves.toEqual(widened);
  });

  it('the allow-list it returns drives assertCanHold', async () => {
    const account = await repository.insert(bank);

    expect(() => account.assertCanHold(INR)).not.toThrow();
    expect(() => account.assertCanHold(USDT)).toThrow();
  });

  it('rejects a currency that is not in the currencies table', async () => {
    await expect(
      repository.insert({ ...exchange, allowedCurrencies: ['GBP'] }),
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' });
  });

  it('writes nothing at all when the allow-list is rejected', async () => {
    await expect(
      repository.insert({ ...exchange, allowedCurrencies: ['GBP'] }),
    ).rejects.toThrow();

    // The account insert and its currencies share one transaction.
    await expect(repository.list()).resolves.toEqual([]);
  });
});

describe('SqliteAccountRepository.delete', () => {
  let database: SqliteDatabase;
  let repository: SqliteAccountRepository;

  beforeEach(() => {
    database = openTestDatabase();
    repository = new SqliteAccountRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  // `Number`, because the connection runs with SQLite's 64-bit integers on
  // (§6), so even a COUNT arrives as a bigint.
  const count = (sql: string): number =>
    Number((database.prepare(sql).get() as { c: number | bigint }).c);

  const exchange = {
    code: 'coindcx',
    name: 'CoinDCX',
    type: 'exchange' as const,
    companyId: null,
    allowedCurrencies: ['USDT', 'INR'],
  };

  it('removes the account and its allow-list', async () => {
    const account = await repository.insert(exchange);

    await repository.delete(account.id);

    await expect(repository.findById(account.id)).resolves.toBeNull();
    expect(count('SELECT COUNT(*) c FROM account_currencies')).toBe(0);
  });

  it('takes the addresses and the fee schedules with it', async () => {
    // Both are configuration *for* the account: an address book and a 0.5%
    // schedule belonging to an exchange that is gone are orphans, not history.
    const account = await repository.insert(exchange);

    database
      .prepare(
        `INSERT INTO account_identifiers (account_id, kind, value)
         VALUES (?, 'wallet', '0xabc')`,
      )
      .run(account.id);
    database
      .prepare(
        `INSERT INTO fee_schedules
           (account_id, fee_type, basis, rate_bps, effective_from)
         VALUES (?, 'exchange_fee', 'to_amount', 50, '2025-01-01')`,
      )
      .run(account.id);

    await repository.delete(account.id);

    expect(count('SELECT COUNT(*) c FROM account_identifiers')).toBe(0);
    expect(count('SELECT COUNT(*) c FROM fee_schedules')).toBe(0);
  });

  it('refuses an account a transaction points at, from either side', async () => {
    // ON DELETE RESTRICT on both `from_account_id` and `to_account_id`. This
    // is the guarantee `DeleteAccount`'s friendlier sentence stands on: even
    // if the count were raced past, the ledger cannot lose a party to a leg.
    const from = await repository.insert(exchange);
    const to = await repository.insert({
      ...exchange,
      code: 'bank-hdfc',
      name: 'HDFC',
      type: 'bank',
      allowedCurrencies: ['INR'],
    });

    database
      .prepare('INSERT INTO companies (code, name) VALUES (?, ?)')
      .run('Tradeify001', 'Tradeify');
    database
      .prepare(
        `INSERT INTO payouts (code, company_id, trader_id, payout_date, gross_amount, currency_code)
         VALUES ('P1', 1, 1, '2025-03-10', 100801, 'USD')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO transactions
           (code, payout_id, txn_date, kind, from_account_id, to_account_id,
            from_amount, from_currency, to_amount, to_currency)
         VALUES ('T1', 1, '2025-03-12', 'sale', ?, ?, 100000000, 'USDT', 9766, 'INR')`,
      )
      .run(from.id, to.id);

    // RESTRICT reports itself as `SQLITE_CONSTRAINT_TRIGGER` rather than
    // `..._FOREIGNKEY`: it is checked as the row goes, not at the end of the
    // statement. The message is "FOREIGN KEY constraint failed" either way,
    // which is exactly why nobody should be reading it.
    await expect(repository.delete(from.id)).rejects.toMatchObject({
      code: 'SQLITE_CONSTRAINT_TRIGGER',
    });
    await expect(repository.delete(to.id)).rejects.toMatchObject({
      code: 'SQLITE_CONSTRAINT_TRIGGER',
    });
  });

  it('is a no-op for an id that is not there', async () => {
    await repository.insert(exchange);

    await expect(repository.delete(4242)).resolves.toBeUndefined();

    await expect(repository.list()).resolves.toHaveLength(1);
  });
});
