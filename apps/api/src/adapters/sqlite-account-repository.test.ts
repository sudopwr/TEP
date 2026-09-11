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
