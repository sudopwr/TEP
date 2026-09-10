import { describe, expect, it } from 'vitest';

import {
  COINDCX_EXCHANGE_FEE,
  COINDCX_GST,
  TestWorld,
} from '../../test/fakes/world';
import { CurrencyNotAllowedError } from '../domain/errors';
import { Payout } from '../domain/payout';
import { USD } from '../domain/currency';
import { Money } from '../domain/money';

import { RecordTransaction } from './record-transaction';
import { RecordSale, type RecordSaleCommand } from './record-sale';

const PAYOUT = Payout.create({
  id: 1,
  code: 'TradeifyPayout001',
  companyId: 1,
  payoutDate: '2025-03-10',
  reference: null,
  gross: Money.fromDecimalString('1008.01', USD),
  charges: Money.fromDecimalString('100.79', USD),
  notes: null,
});

const setup = (options: { schedules?: boolean } = {}) => {
  const world = TestWorld.withCounterparties();
  world.payouts.seed(PAYOUT);

  if (options.schedules !== false) {
    world.feeSchedules.seed(COINDCX_EXCHANGE_FEE, COINDCX_GST);
  }

  const useCase = new RecordSale({
    recordTransaction: new RecordTransaction({
      transactions: world.transactions,
      payouts: world.payouts,
      accounts: world.accounts,
      currencies: world.currencies,
    }),
    transactions: world.transactions,
    feeSchedules: world.feeSchedules,
    currencies: world.currencies,
  });

  return { world, useCase };
};

const command = (
  overrides: Partial<RecordSaleCommand> = {},
): RecordSaleCommand => ({
  code: 'Transaction003',
  payoutId: 1,
  parentId: null,
  txnDate: '2025-03-16',
  fromAccountId: 4,
  toAccountId: 5,
  fromAmount: '45.2292',
  fromCurrencyCode: 'USDT',
  rate: 9766520000n,
  settlementCurrencyCode: 'INR',
  tds: '44.89',
  ...overrides,
});

describe('RecordSale (UC3)', () => {
  it('computes gross proceeds from the amount and the rate', async () => {
    const { useCase } = setup();

    // 45.2292 USDT at ₹97.6652 is ₹4,417.31886384 -> ₹4,417.32.
    const result = await useCase.execute(command());

    expect(result.grossProceeds.toDecimalString()).toBe('4417.32');
    expect(result.grossProceeds.currency.code).toBe('INR');
  });

  it('records the transaction with gross proceeds as its to-amount', async () => {
    const { useCase } = setup();

    const { transaction } = await useCase.execute(command());

    // §13: to_amount on a sale is gross proceeds, matching the statement.
    expect(transaction.kind).toBe('sale');
    expect(transaction.toAmount.toDecimalString()).toBe('4417.32');
    expect(transaction.rate).toBe(9766520000n);
  });

  it('applies the fee schedule to derive the exchange fee and GST', async () => {
    const { useCase } = setup();

    const { fees } = await useCase.execute(command());
    const byType = new Map(fees.map((fee) => [fee.feeType, fee.amount]));

    // 0.50% of ₹4,417.32 = ₹22.09; 18% of that = ₹3.98.
    expect(byType.get('exchange_fee')?.toDecimalString()).toBe('22.09');
    expect(byType.get('gst')?.toDecimalString()).toBe('3.98');
  });

  it('records the TDS it was handed rather than computing it', async () => {
    const { useCase } = setup();

    const { fees } = await useCase.execute(command({ tds: '44.89' }));
    const tds = fees.find((fee) => fee.feeType === 'tds');

    expect(tds?.amount.toDecimalString()).toBe('44.89');
  });

  it('returns the correct net INR', async () => {
    const { useCase } = setup();

    // 4417.32 - 22.09 - 3.98 - 44.89 = 4346.36
    const result = await useCase.execute(command());

    expect(result.totalFees.toDecimalString()).toBe('70.96');
    expect(result.netCredited.toDecimalString()).toBe('4346.36');
  });

  it('persists every fee against the transaction', async () => {
    const { world, useCase } = setup();

    const { transaction } = await useCase.execute(command());
    const stored = await world.transactions.listFeesByTransaction(
      transaction.id,
    );

    expect(stored.map((fee) => fee.feeType).sort()).toEqual([
      'exchange_fee',
      'gst',
      'tds',
    ]);
  });

  it('omits TDS entirely when none is declared', async () => {
    const { useCase } = setup();

    const result = await useCase.execute(command({ tds: null }));

    expect(result.fees.some((fee) => fee.feeType === 'tds')).toBe(false);
    // 4417.32 - 22.09 - 3.98 = 4391.25
    expect(result.netCredited.toDecimalString()).toBe('4391.25');
  });

  it('nets to the gross when the exchange declares no schedule', async () => {
    const { useCase } = setup({ schedules: false });

    const result = await useCase.execute(command({ tds: null }));

    expect(result.fees).toEqual([]);
    expect(result.netCredited.toDecimalString()).toBe('4417.32');
  });

  it('honours an explicit rounding mode', async () => {
    const { useCase } = setup();

    const result = await useCase.execute(
      command({ rounding: 'toward-zero', tds: null }),
    );

    // ₹4,417.31886384 truncates to ₹4,417.31, and 0.5% of that to ₹22.08.
    expect(result.grossProceeds.toDecimalString()).toBe('4417.31');
    const exchangeFee = result.fees.find(
      (fee) => fee.feeType === 'exchange_fee',
    );
    expect(exchangeFee?.amount.toDecimalString()).toBe('22.08');
  });

  it('refuses to settle into an account that cannot hold rupees', async () => {
    const { useCase } = setup();

    await expect(useCase.execute(command({ toAccountId: 3 }))).rejects.toThrow(
      CurrencyNotAllowedError,
    );
  });

  it('stores no fees when the transaction itself is rejected', async () => {
    const { world, useCase } = setup();

    await expect(
      useCase.execute(command({ toAccountId: 3 })),
    ).rejects.toThrow();

    expect(world.transactions.allFees()).toEqual([]);
  });
});
