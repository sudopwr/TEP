import { describe, expect, it } from 'vitest';

import { TestWorld } from '../../test/fakes/world';
import { USDT } from '../domain/currency';
import { Money } from '../domain/money';

import { GetAccountBalances } from './get-account-balances';

const setup = () => {
  const world = TestWorld.withReferencePayout();
  const useCase = new GetAccountBalances({
    accounts: world.accounts,
    transactions: world.transactions,
  });
  return { world, useCase };
};

const balanceOf = (
  balances: Awaited<ReturnType<GetAccountBalances['execute']>>,
  accountCode: string,
  currencyCode: string,
): string | undefined =>
  balances
    .find(
      (row) =>
        row.account.code === accountCode && row.currency.code === currencyCode,
    )
    ?.balance.toDecimalString();

describe('GetAccountBalances (UC7)', () => {
  it('reproduces the CLAUDE.md §10 balances', async () => {
    const { useCase } = setup();

    const balances = await useCase.execute({});

    expect(balanceOf(balances, 'bank-hdfc', 'INR')).toBe('84642.93');
    expect(balanceOf(balances, 'coindcx', 'USDT')).toBe('14.09080000');
    expect(balanceOf(balances, 'trustwallet', 'USDT')).toBe('1.33230000');
  });

  it('keeps crypto dust rather than rounding it away', async () => {
    const { useCase } = setup();

    const balances = await useCase.execute({});
    const dust = balances.find(
      (row) =>
        row.account.code === 'trustwallet' && row.currency.code === 'USDT',
    );

    expect(dust?.balance.minor).toBe(133230000n);
  });

  it('omits an account that has netted to zero', async () => {
    const { useCase } = setup();

    const balances = await useCase.execute({});

    // Rise received $907.22 and sent $907.22. The $16.31 of network fees is
    // already inside the from-amounts, so it does not debit a second time.
    expect(balanceOf(balances, 'rise', 'USD')).toBeUndefined();
  });

  it('derives the balance rather than reading a stored field', async () => {
    const { world, useCase } = setup();
    const dust = Money.fromDecimalString('1.3323', USDT);

    // Sweep the wallet dust onto the exchange; nothing updates a stored
    // total, and yet both balances move.
    await world.transactions.insert({
      code: 'Transaction300',
      payoutId: 1,
      parentId: null,
      txnDate: '2025-03-25',
      kind: 'transfer',
      fromAccountId: 3,
      toAccountId: 4,
      fromAmount: dust,
      toAmount: dust,
      rate: null,
    });

    const after = await useCase.execute({});

    expect(balanceOf(after, 'trustwallet', 'USDT')).toBeUndefined();
    expect(balanceOf(after, 'coindcx', 'USDT')).toBe('15.42310000');
  });

  it('scopes to one payout when asked', async () => {
    const { useCase } = setup();

    const balances = await useCase.execute({ payoutId: 1 });

    expect(balanceOf(balances, 'bank-hdfc', 'INR')).toBe('84642.93');
  });

  it('returns nothing for a payout with no legs', async () => {
    const { useCase } = setup();

    expect(await useCase.execute({ payoutId: 99 })).toEqual([]);
  });

  it('debits a fee from the side that holds its currency', async () => {
    const { useCase } = setup();

    const balances = await useCase.execute({});

    // The rupee fees ride the sale legs and come off the bank, which is the
    // side denominated in rupees: ₹86,027.56 in, ₹1,384.63 of fees out.
    expect(balanceOf(balances, 'bank-hdfc', 'INR')).toBe('84642.93');
  });
});
