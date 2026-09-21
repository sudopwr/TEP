import { describe, expect, it } from 'vitest';

import { TestWorld } from '../../test/fakes/world';
import { CompanyNotFoundError, NonPositiveAmountError } from '../domain/errors';
import { UnknownCurrencyError } from '../domain/errors';

import { RecordPayout, type RecordPayoutCommand } from './record-payout';

const setup = () => {
  const world = TestWorld.withCounterparties();
  const useCase = new RecordPayout({
    payouts: world.payouts,
    companies: world.companies,
    traders: world.traders,
    currencies: world.currencies,
    clock: world.clock,
  });
  return { world, useCase };
};

const command = (
  overrides: Partial<RecordPayoutCommand> = {},
): RecordPayoutCommand => ({
  code: 'TradeifyPayout002',
  companyId: 1,
  traderId: 1,
  payoutDate: '2025-04-02',
  grossAmount: '1008.01',
  currencyCode: 'USD',
  charges: '100.79',
  reference: 'FTDFYSLX50676373980',
  ...overrides,
});

describe('RecordPayout (UC1)', () => {
  it('records a payout and gives it an id', async () => {
    const { useCase } = setup();

    const payout = await useCase.execute(command());

    expect(payout.id).toBe(1);
    expect(payout.code).toBe('TradeifyPayout002');
    expect(payout.gross.toDecimalString()).toBe('1008.01');
    expect(payout.gross.currency.code).toBe('USD');
    expect(payout.charges.toDecimalString()).toBe('100.79');
  });

  it('persists it, so a second read finds it', async () => {
    const { world, useCase } = setup();

    const payout = await useCase.execute(command());

    await expect(world.payouts.findById(payout.id)).resolves.toEqual(payout);
    expect(world.payouts.size()).toBe(1);
  });

  it('opens with no charges when none are declared', async () => {
    const { useCase } = setup();
    const { charges: _ignored, ...rest } = command();

    const payout = await useCase.execute(rest);

    expect(payout.charges.isZero()).toBe(true);
  });

  it('dates the payout today when no date is given', async () => {
    const { world, useCase } = setup();
    world.clock.set('2025-07-04T09:00:00.000Z');
    const { payoutDate: _ignored, ...rest } = command();

    const payout = await useCase.execute(rest);

    expect(payout.payoutDate).toBe('2025-07-04');
  });

  it('rejects an unknown company', async () => {
    const { useCase } = setup();

    await expect(useCase.execute(command({ companyId: 99 }))).rejects.toThrow(
      CompanyNotFoundError,
    );
  });

  it('rejects a gross amount of zero', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ grossAmount: '0.00' })),
    ).rejects.toThrow(NonPositiveAmountError);
  });

  it('rejects a negative gross amount', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ grossAmount: '-1.00' })),
    ).rejects.toThrow(NonPositiveAmountError);
  });

  it('rejects negative charges', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ charges: '-1.00' })),
    ).rejects.toThrow(NonPositiveAmountError);
  });

  it('rejects an unknown currency', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ currencyCode: 'GBP' })),
    ).rejects.toThrow(UnknownCurrencyError);
  });

  it('stores nothing when it rejects', async () => {
    const { world, useCase } = setup();

    await expect(
      useCase.execute(command({ grossAmount: '0.00' })),
    ).rejects.toThrow();

    expect(world.payouts.size()).toBe(0);
  });
});
