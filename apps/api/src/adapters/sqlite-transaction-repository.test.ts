import {
  INR,
  Money,
  NonPositiveAmountError,
  RateOnSameCurrencyError,
  SameAccountTransferError,
  USDT,
} from '@payout/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { arrangeReferencePayout } from '../../test/arrange';
import type { SqliteDatabase } from '../db/connection';

import { SqliteTransactionRepository } from './sqlite-transaction-repository';

describe('SqliteTransactionRepository', () => {
  let database: SqliteDatabase;
  let repository: SqliteTransactionRepository;

  beforeEach(() => {
    const arranged = arrangeReferencePayout();
    database = arranged.database;
    repository = new SqliteTransactionRepository(database, arranged.currencies);
  });

  afterEach(() => {
    database.close();
  });

  const draft = (overrides: Record<string, unknown> = {}) => ({
    code: 'Transaction100',
    payoutId: 1,
    parentId: null,
    txnDate: '2025-03-21',
    kind: 'transfer' as const,
    fromAccountId: 3,
    toAccountId: 4,
    fromAmount: Money.fromDecimalString('222.44', USDT),
    toAmount: Money.fromDecimalString('222.44', USDT),
    rate: null,
    ...overrides,
  });

  it('reads the seeded tree back with every amount intact', async () => {
    const legs = await repository.listByPayout(1);

    expect(legs).toHaveLength(13);
    const sale = legs.find((one) => one.code === 'Transaction0011');
    expect(sale?.fromAmount.toDecimalString()).toBe('741.72000000');
    expect(sale?.toAmount.toDecimalString()).toBe('72883.58');
    expect(sale?.rate).toBe(9826292937n);
  });

  it('keeps a USDT amount exact through the round trip', async () => {
    const inserted = await repository.insert(
      draft({ fromAmount: Money.fromMinor(74172000000n, USDT) }),
    );

    expect(inserted.fromAmount.minor).toBe(74172000000n);
    expect(typeof inserted.fromAmount.minor).toBe('bigint');
  });

  it('finds children by parent', async () => {
    const children = await repository.listChildren(1);

    expect(children.map((one) => one.code).sort()).toEqual([
      'Transaction002',
      'Transaction004',
      'Transaction006',
      'Transaction009',
    ]);
  });

  it('lists every leg across every payout', async () => {
    await expect(repository.list()).resolves.toHaveLength(13);
  });

  it('attaches a parent through update', async () => {
    const leg = await repository.insert(draft());
    const parent = await repository.findById(2);
    if (parent === null) throw new Error('seed missing');

    const attached = await repository.update(leg.attachTo(parent));

    expect(attached.parentId).toBe(2);
    await expect(repository.findById(leg.id)).resolves.toEqual(attached);
  });

  describe('invariants reach the caller as domain errors', () => {
    it('refuses both sides being one account', async () => {
      await expect(
        repository.insert(draft({ fromAccountId: 4, toAccountId: 4 })),
      ).rejects.toThrow(SameAccountTransferError);
    });

    it('refuses a rate on a same-currency move', async () => {
      await expect(
        repository.insert(draft({ rate: 100000000n })),
      ).rejects.toThrow(RateOnSameCurrencyError);
    });

    it('refuses a zero amount', async () => {
      await expect(
        repository.insert(draft({ toAmount: Money.zero(USDT) })),
      ).rejects.toThrow(NonPositiveAmountError);
    });

    it('writes nothing when it refuses', async () => {
      await expect(
        repository.insert(draft({ fromAccountId: 4, toAccountId: 4 })),
      ).rejects.toThrow();

      await expect(repository.list()).resolves.toHaveLength(13);
    });

    it('still refuses a parent that does not exist, via the foreign key', async () => {
      await expect(
        repository.insert(draft({ parentId: 9999 })),
      ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' });
    });
  });

  describe('fees', () => {
    it('reads the seeded fees for a payout', async () => {
      const fees = await repository.listFeesByPayout(1);

      expect(fees).toHaveLength(16);
      const inr = fees.filter((fee) => fee.amount.currency.code === 'INR');
      expect(inr).toHaveLength(12);
    });

    it('reads the fees for one leg', async () => {
      const fees = await repository.listFeesByTransaction(3);

      expect(fees.map((fee) => fee.feeType).sort()).toEqual([
        'exchange_fee',
        'gst',
        'tds',
      ]);
    });

    it('records a new fee', async () => {
      const fee = await repository.recordFee({
        transactionId: 5,
        feeType: 'platform_charge',
        amount: Money.fromDecimalString('10.00', INR),
      });

      expect(fee.amount.toDecimalString()).toBe('10.00');
      await expect(repository.listFeesByTransaction(5)).resolves.toHaveLength(
        4,
      );
    });

    it('replaces rather than duplicates when a type is recorded twice', async () => {
      const before = await repository.listFeesByTransaction(3);

      const replaced = await repository.recordFee({
        transactionId: 3,
        feeType: 'exchange_fee',
        amount: Money.fromDecimalString('370.64', INR),
      });

      const after = await repository.listFeesByTransaction(3);

      expect(after).toHaveLength(before.length);
      expect(replaced.amount.toDecimalString()).toBe('370.64');
      expect(
        after
          .find((fee) => fee.feeType === 'exchange_fee')
          ?.amount.toDecimalString(),
      ).toBe('370.64');
    });

    it('keeps the fee id stable across a replacement', async () => {
      const original = await repository.listFeesByTransaction(3);
      const originalId = original.find(
        (fee) => fee.feeType === 'exchange_fee',
      )?.id;

      const replaced = await repository.recordFee({
        transactionId: 3,
        feeType: 'exchange_fee',
        amount: Money.fromDecimalString('22.58', INR),
      });

      expect(replaced.id).toBe(originalId);
    });

    it('refuses a negative fee as a domain error', async () => {
      await expect(
        repository.recordFee({
          transactionId: 3,
          feeType: 'gst',
          amount: Money.fromMinor(-1n, INR),
        }),
      ).rejects.toThrow(NonPositiveAmountError);
    });

    it('lists every fee in the database', async () => {
      await expect(repository.listFees()).resolves.toHaveLength(16);
    });
  });
});
