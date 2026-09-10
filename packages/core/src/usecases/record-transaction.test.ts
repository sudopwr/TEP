import { describe, expect, it } from 'vitest';

import { TestWorld } from '../../test/fakes/world';
import { USD } from '../domain/currency';
import {
  AccountNotFoundError,
  CurrencyNotAllowedError,
  ParentPayoutMismatchError,
  PayoutNotFoundError,
  RateOnSameCurrencyError,
  SameAccountTransferError,
  TransactionNotFoundError,
} from '../domain/errors';
import { Money } from '../domain/money';
import { Payout } from '../domain/payout';

import {
  RecordTransaction,
  type RecordTransactionCommand,
} from './record-transaction';

/** A second payout, so a parent can belong to the wrong one. */
const OTHER_PAYOUT = Payout.create({
  id: 2,
  code: 'TradeifyPayout002',
  companyId: 1,
  payoutDate: '2025-04-02',
  reference: null,
  gross: Money.fromDecimalString('500.00', USD),
  charges: Money.zero(USD),
  notes: null,
});

/** The reference tree (payout 1, legs 1–13) plus an empty second payout. */
const setup = () => {
  const world = TestWorld.withReferencePayout();
  world.payouts.seed(OTHER_PAYOUT);

  const useCase = new RecordTransaction({
    transactions: world.transactions,
    payouts: world.payouts,
    accounts: world.accounts,
    currencies: world.currencies,
  });

  return { world, useCase };
};

const command = (
  overrides: Partial<RecordTransactionCommand> = {},
): RecordTransactionCommand => ({
  code: 'Transaction100',
  payoutId: 1,
  parentId: null,
  txnDate: '2025-03-15',
  kind: 'transfer',
  fromAccountId: 3,
  toAccountId: 4,
  fromAmount: '222.44',
  fromCurrencyCode: 'USDT',
  toAmount: '222.44',
  toCurrencyCode: 'USDT',
  rate: null,
  ...overrides,
});

describe('RecordTransaction (UC2)', () => {
  it('records a leg against its payout', async () => {
    const { useCase } = setup();

    const transaction = await useCase.execute(command());

    expect(transaction.code).toBe('Transaction100');
    expect(transaction.payoutId).toBe(1);
    expect(transaction.kind).toBe('transfer');
    expect(transaction.fromAmount.toDecimalString()).toBe('222.44000000');
    expect(transaction.parentId).toBeNull();
  });

  it('persists it', async () => {
    const { world, useCase } = setup();

    const transaction = await useCase.execute(command());

    await expect(world.transactions.findById(transaction.id)).resolves.toEqual(
      transaction,
    );
  });

  it('records a cross-currency leg with its rate', async () => {
    const { useCase } = setup();

    const sale = await useCase.execute(
      command({
        kind: 'sale',
        fromAccountId: 4,
        toAccountId: 5,
        fromAmount: '45.2292',
        fromCurrencyCode: 'USDT',
        toAmount: '4417.32',
        toCurrencyCode: 'INR',
        rate: 9766520000n,
      }),
    );

    expect(sale.rate).toBe(9766520000n);
    expect(sale.grossProceeds().toDecimalString()).toBe('4417.32');
  });

  it('attaches a parent from the same payout', async () => {
    const { useCase } = setup();

    const transaction = await useCase.execute(command({ parentId: 2 }));

    expect(transaction.parentId).toBe(2);
  });

  it('rejects a parent belonging to a different payout', async () => {
    const { useCase } = setup();

    // Leg 2 belongs to payout 1; this new leg claims payout 2.
    await expect(
      useCase.execute(command({ payoutId: 2, parentId: 2 })),
    ).rejects.toThrow(ParentPayoutMismatchError);
  });

  it('names both payouts on the parent mismatch', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ payoutId: 2, parentId: 2 })),
    ).rejects.toMatchObject({
      childCode: 'Transaction100',
      childPayoutId: 2,
      parentCode: 'Transaction002',
      parentPayoutId: 1,
    });
  });

  it('rejects a currency the destination account cannot hold', async () => {
    const { useCase } = setup();

    // Account 5 is the bank, and the bank holds rupees only.
    await expect(
      useCase.execute(command({ toAccountId: 5, toCurrencyCode: 'USDT' })),
    ).rejects.toThrow(CurrencyNotAllowedError);
  });

  it('names the account and the currency it refused', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ toAccountId: 5, toCurrencyCode: 'USDT' })),
    ).rejects.toMatchObject({
      accountCode: 'bank-hdfc',
      currencyCode: 'USDT',
      allowed: ['INR'],
    });
  });

  it('rejects a currency the source account cannot hold', async () => {
    const { useCase } = setup();

    // The bank can no more send USDT than receive it.
    await expect(
      useCase.execute(
        command({
          fromAccountId: 5,
          toAccountId: 4,
          fromCurrencyCode: 'USDT',
        }),
      ),
    ).rejects.toThrow(CurrencyNotAllowedError);
  });

  it('allows any currency on an account with an empty allow-list', async () => {
    const { world, useCase } = setup();
    const open = await world.accounts.insert({
      code: 'scratch',
      name: 'Scratch',
      type: 'wallet',
      companyId: null,
      allowedCurrencies: [],
    });

    await expect(
      useCase.execute(command({ toAccountId: open.id })),
    ).resolves.toBeDefined();
  });

  it('rejects both sides being the same account', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ fromAccountId: 4, toAccountId: 4 })),
    ).rejects.toThrow(SameAccountTransferError);
  });

  it('rejects a rate on a same-currency move', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ rate: 100000000n })),
    ).rejects.toThrow(RateOnSameCurrencyError);
  });

  it('rejects an unknown payout', async () => {
    const { useCase } = setup();

    await expect(useCase.execute(command({ payoutId: 99 }))).rejects.toThrow(
      PayoutNotFoundError,
    );
  });

  it('rejects an unknown account', async () => {
    const { useCase } = setup();

    await expect(useCase.execute(command({ toAccountId: 99 }))).rejects.toThrow(
      AccountNotFoundError,
    );
  });

  it('rejects an unknown parent', async () => {
    const { useCase } = setup();

    await expect(useCase.execute(command({ parentId: 999 }))).rejects.toThrow(
      TransactionNotFoundError,
    );
  });

  it('stores nothing when it rejects', async () => {
    const { world, useCase } = setup();
    const before = world.transactions.all().length;

    await expect(
      useCase.execute(command({ fromAccountId: 4, toAccountId: 4 })),
    ).rejects.toThrow();

    expect(world.transactions.all()).toHaveLength(before);
  });
});
