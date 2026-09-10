import { describe, expect, it } from 'vitest';

import {
  COINDCX_EXCHANGE_FEE,
  COINDCX_GST,
  TestWorld,
} from '../../test/fakes/world';
import { INR, USDT } from '../domain/currency';
import { Money } from '../domain/money';

import { RunDataQualityChecks } from './run-data-quality-checks';

const setup = (options: { schedules?: boolean } = {}) => {
  const world = TestWorld.withReferencePayout();
  if (options.schedules === true) {
    world.feeSchedules.seed(COINDCX_EXCHANGE_FEE, COINDCX_GST);
  }

  const useCase = new RunDataQualityChecks({
    payouts: world.payouts,
    transactions: world.transactions,
    accounts: world.accounts,
    feeSchedules: world.feeSchedules,
  });

  return { world, useCase };
};

describe('RunDataQualityChecks (UC8)', () => {
  it('flags the one legitimate oddity in the reference tree', async () => {
    const { useCase } = setup();

    const issues = await useCase.execute({});

    // Transaction0011 sells 741.72 USDT while its own transfer delivered
    // only 222.3877 — legitimate, because CoinDCX had accumulated balance,
    // and exactly the case §7 says to surface rather than block.
    expect(issues).toHaveLength(1);
    expect(issues[0]?.check).toBe('exceeds_parent');
    expect(issues[0]?.subject).toBe('Transaction0011');
  });

  it('flags a cross-currency move with no rate', async () => {
    const { world, useCase } = setup();
    await world.transactions.insert({
      code: 'Transaction400',
      payoutId: 1,
      parentId: null,
      txnDate: '2025-03-22',
      kind: 'sale',
      fromAccountId: 4,
      toAccountId: 5,
      fromAmount: Money.fromDecimalString('10', USDT),
      toAmount: Money.fromDecimalString('982.50', INR),
      rate: null,
    });

    const issues = await useCase.execute({});

    expect(
      issues.some(
        (issue) =>
          issue.check === 'missing_rate' && issue.subject === 'Transaction400',
      ),
    ).toBe(true);
  });

  it('flags a to-amount that does not reconcile with rate and fees', async () => {
    const { world, useCase } = setup();
    await world.transactions.insert({
      code: 'Transaction401',
      payoutId: 1,
      parentId: null,
      txnDate: '2025-03-22',
      kind: 'sale',
      fromAccountId: 4,
      toAccountId: 5,
      fromAmount: Money.fromDecimalString('10', USDT),
      // 10 USDT at 98.25 is ₹982.50, not ₹5,000.
      toAmount: Money.fromDecimalString('5000.00', INR),
      rate: 9825000000n,
    });

    const issues = await useCase.execute({});

    expect(
      issues.some(
        (issue) =>
          issue.check === 'unreconciled_amount' &&
          issue.subject === 'Transaction401',
      ),
    ).toBe(true);
  });

  it('does not flag the reference legs as unreconciled', async () => {
    const { useCase } = setup();

    const issues = await useCase.execute({});

    expect(
      issues.filter((issue) => issue.check === 'unreconciled_amount'),
    ).toEqual([]);
  });

  it('flags a fee that is off the declared schedule', async () => {
    const { world, useCase } = setup({ schedules: true });

    // §9 defect 2: the swapped value implies 8.39%, not 0.5%.
    await world.transactions.recordFee({
      transactionId: 3,
      feeType: 'exchange_fee',
      amount: Money.fromDecimalString('370.64', INR),
    });

    const issues = await useCase.execute({ feeTolerancePct: 2 });

    expect(
      issues.some(
        (issue) =>
          issue.check === 'fee_off_schedule' &&
          issue.subject === 'Transaction003',
      ),
    ).toBe(true);
  });

  it('runs no fee check at all when no schedule is declared', async () => {
    const { world, useCase } = setup();

    await world.transactions.recordFee({
      transactionId: 3,
      feeType: 'exchange_fee',
      amount: Money.fromDecimalString('370.64', INR),
    });

    const issues = await useCase.execute({ feeTolerancePct: 2 });

    expect(
      issues.filter((issue) => issue.check === 'fee_off_schedule'),
    ).toEqual([]);
  });

  it('flags a currency an account is not permitted to hold', async () => {
    const { world, useCase } = setup();
    // Inserted directly rather than through UC2: the check has to catch what
    // the entry path would have refused, because the legacy CSV import (F12)
    // does not go through UC2. The bank holds rupees only.
    await world.transactions.insert({
      code: 'Transaction500',
      payoutId: 1,
      parentId: null,
      txnDate: '2025-03-22',
      kind: 'transfer',
      fromAccountId: 4,
      toAccountId: 5,
      fromAmount: Money.fromDecimalString('10', USDT),
      toAmount: Money.fromDecimalString('10', USDT),
      rate: null,
    });

    const issues = await useCase.execute({});

    expect(
      issues.some(
        (issue) =>
          issue.check === 'currency_not_allowed' &&
          issue.subject === 'Transaction500',
      ),
    ).toBe(true);
  });

  it('flags a payout whose money never reached a bank', async () => {
    const { world, useCase } = setup();
    await world.payouts.insert({
      code: 'TradeifyPayout099',
      companyId: 1,
      payoutDate: '2025-05-01',
      reference: null,
      gross: Money.fromDecimalString('100.00', INR),
      charges: Money.zero(INR),
      notes: null,
    });

    const issues = await useCase.execute({});

    expect(
      issues.some(
        (issue) =>
          issue.check === 'no_bank_leg' &&
          issue.subject === 'TradeifyPayout099',
      ),
    ).toBe(true);
  });

  it('scopes to a single payout when asked', async () => {
    const { world, useCase } = setup();
    await world.payouts.insert({
      code: 'TradeifyPayout099',
      companyId: 1,
      payoutDate: '2025-05-01',
      reference: null,
      gross: Money.fromDecimalString('100.00', INR),
      charges: Money.zero(INR),
      notes: null,
    });

    const issues = await useCase.execute({ payoutId: 1 });

    expect(issues.every((issue) => issue.subject !== 'TradeifyPayout099')).toBe(
      true,
    );
  });

  it('carries a readable reason on every issue', async () => {
    const { useCase } = setup();

    const issues = await useCase.execute({});

    for (const issue of issues) {
      expect(issue.detail.length).toBeGreaterThan(0);
      expect(issue.subjectKind).toMatch(/^(transaction|payout)$/);
    }
  });
});
