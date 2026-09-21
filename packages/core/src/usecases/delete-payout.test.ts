import { describe, expect, it } from 'vitest';

import { TestWorld, reference } from '../../test/fakes/world';
import { PayoutNotFoundError } from '../domain/errors';

import { DeletePayout } from './delete-payout';

const setup = () => {
  const world = TestWorld.withReferencePayout();
  const useCase = new DeletePayout({
    payouts: world.payouts,
    transactions: world.transactions,
  });

  return { world, useCase };
};

describe('DeletePayout', () => {
  it('removes the payout', async () => {
    const { world, useCase } = setup();

    await useCase.execute({ payoutId: reference.PAYOUT.id });

    await expect(
      world.payouts.findById(reference.PAYOUT.id),
    ).resolves.toBeNull();
  });

  it('takes the legs and their fees with it', async () => {
    // §10's tree is thirteen legs four levels deep, and every fee hangs off
    // one of them. A payout whose legs outlive it is money in the balances
    // belonging to an award that no longer exists.
    const { world, useCase } = setup();

    await useCase.execute({ payoutId: reference.PAYOUT.id });

    await expect(
      world.transactions.listByPayout(reference.PAYOUT.id),
    ).resolves.toEqual([]);
    await expect(
      world.transactions.listFeesByPayout(reference.PAYOUT.id),
    ).resolves.toEqual([]);
  });

  it('reports what went, counted while there was still something to count', async () => {
    const { useCase } = setup();

    const deleted = await useCase.execute({ payoutId: reference.PAYOUT.id });

    expect(deleted.payout.code).toBe(reference.PAYOUT.code);
    expect(deleted.transactionsDeleted).toBe(reference.TRANSACTIONS.length);
    expect(deleted.feesDeleted).toBe(reference.FEES.length);
  });

  it('hands back the payout as it was, so the caller can name it', async () => {
    // There is nothing on file with that id by the time this resolves, and
    // "Payout deleted" is a worse sentence than "TradeifyPayout001 deleted".
    const { useCase } = setup();

    const deleted = await useCase.execute({ payoutId: reference.PAYOUT.id });

    expect(deleted.payout.gross.toDecimalString()).toBe(
      reference.PAYOUT.gross.toDecimalString(),
    );
  });

  it('refuses a payout that is not there', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ payoutId: 4242 })).rejects.toBeInstanceOf(
      PayoutNotFoundError,
    );
  });

  it('leaves every other payout, and the company, alone', async () => {
    const { world, useCase } = setup();
    const second = await world.payouts.insert({
      code: 'TradeifyPayout002',
      companyId: reference.PAYOUT.companyId,
      traderId: reference.PAYOUT.traderId,
      payoutDate: '2025-05-01',
      reference: null,
      gross: reference.PAYOUT.gross,
      charges: reference.PAYOUT.charges,
      notes: null,
    });

    await useCase.execute({ payoutId: reference.PAYOUT.id });

    await expect(world.payouts.findById(second.id)).resolves.not.toBeNull();
    await expect(
      world.companies.findById(reference.PAYOUT.companyId),
    ).resolves.not.toBeNull();
  });

  it('deletes a payout with no legs at all', async () => {
    const { world, useCase } = setup();
    const empty = await world.payouts.insert({
      code: 'TradeifyPayout003',
      companyId: reference.PAYOUT.companyId,
      traderId: reference.PAYOUT.traderId,
      payoutDate: '2025-05-02',
      reference: null,
      gross: reference.PAYOUT.gross,
      charges: reference.PAYOUT.charges,
      notes: null,
    });

    const deleted = await useCase.execute({ payoutId: empty.id });

    expect(deleted.transactionsDeleted).toBe(0);
    expect(deleted.feesDeleted).toBe(0);
    await expect(world.payouts.findById(empty.id)).resolves.toBeNull();
  });
});
