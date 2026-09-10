import { describe, expect, it } from 'vitest';

import { TestWorld } from '../../test/fakes/world';
import { PayoutNotFoundError } from '../domain/errors';

import { GetSettlement } from './get-settlement';

const setup = () => {
  const world = TestWorld.withReferencePayout();
  const useCase = new GetSettlement({
    payouts: world.payouts,
    transactions: world.transactions,
    accounts: world.accounts,
    currencies: world.currencies,
  });
  return { world, useCase };
};

describe('GetSettlement (UC6)', () => {
  it('reproduces the CLAUDE.md §10 figures', async () => {
    const { useCase } = setup();

    const settlement = await useCase.execute({
      payoutId: 1,
      settlementCurrencyCode: 'INR',
    });

    expect(settlement.grossProceeds.toDecimalString()).toBe('86027.56');
    expect(settlement.totalFees.toDecimalString()).toBe('1384.63');
    expect(settlement.netCredited.toDecimalString()).toBe('84642.93');
  });

  it('breaks the fees down by type', async () => {
    const { useCase } = setup();

    const settlement = await useCase.execute({
      payoutId: 1,
      settlementCurrencyCode: 'INR',
    });

    expect(settlement.feesByType.get('tds')?.toDecimalString()).toBe('868.88');
    expect(settlement.feesByType.get('exchange_fee')?.toDecimalString()).toBe(
      '437.09',
    );
    expect(settlement.feesByType.get('gst')?.toDecimalString()).toBe('78.66');
  });

  it('leaves the USD network fee out of the rupee settlement', async () => {
    const { useCase } = setup();

    const settlement = await useCase.execute({
      payoutId: 1,
      settlementCurrencyCode: 'INR',
    });

    expect(settlement.feesByType.has('network_fee')).toBe(false);
  });

  it('settles in USD when asked, showing the $16.31 of network fees', async () => {
    const { useCase } = setup();

    const settlement = await useCase.execute({
      payoutId: 1,
      settlementCurrencyCode: 'USD',
    });

    expect(settlement.feesByType.get('network_fee')?.toDecimalString()).toBe(
      '16.31',
    );
    expect(settlement.grossProceeds.isZero()).toBe(true);
  });

  it('reports the derived status', async () => {
    const { useCase } = setup();

    const settlement = await useCase.execute({
      payoutId: 1,
      settlementCurrencyCode: 'INR',
    });

    expect(settlement.status).toBe('settled');
  });

  it('defaults to rupees when no currency is named', async () => {
    const { useCase } = setup();

    const settlement = await useCase.execute({ payoutId: 1 });

    expect(settlement.netCredited.toDecimalString()).toBe('84642.93');
  });

  it('rejects an unknown payout', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ payoutId: 99 })).rejects.toThrow(
      PayoutNotFoundError,
    );
  });
});
