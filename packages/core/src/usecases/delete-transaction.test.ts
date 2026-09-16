import { describe, expect, it } from 'vitest';

import { TestWorld, reference } from '../../test/fakes/world';
import { TransactionNotFoundError } from '../domain/errors';

import { DeleteTransaction } from './delete-transaction';

const setup = () => {
  const world = TestWorld.withReferencePayout();
  const useCase = new DeleteTransaction({ transactions: world.transactions });

  return { world, useCase };
};

/**
 * §10's tree, which is what makes these tests worth writing: the credit is the
 * root of thirteen legs four levels deep, each withdrawal carries one transfer
 * and each transfer one sale, and the fees hang off the withdrawals and the
 * sales.
 */
describe('DeleteTransaction', () => {
  it('deletes a leaf, and nothing else', async () => {
    const { world, useCase } = setup();

    const deleted = await useCase.execute({
      transactionId: reference.SALE_003.id,
    });

    expect(deleted.transactionsDeleted).toBe(1);
    await expect(
      world.transactions.findById(reference.SALE_003.id),
    ).resolves.toBeNull();
    await expect(
      world.transactions.listByPayout(reference.PAYOUT.id),
    ).resolves.toHaveLength(reference.TRANSACTIONS.length - 1);
  });

  it('takes the fees on that leaf with it', async () => {
    const { world, useCase } = setup();
    const before = await world.transactions.listFeesByTransaction(
      reference.SALE_003.id,
    );

    const deleted = await useCase.execute({
      transactionId: reference.SALE_003.id,
    });

    expect(before.length).toBeGreaterThan(0);
    expect(deleted.feesDeleted).toBe(before.length);
    await expect(
      world.transactions.listFeesByTransaction(reference.SALE_003.id),
    ).resolves.toEqual([]);
  });

  it('takes the legs below it, because a leg cannot outlive its parent', async () => {
    // Withdrawal A carries transfer A, which carries sale 003. Deleting the
    // withdrawal alone would leave two legs pointing at a `parent_id` that is
    // gone — the orphaned-root shape `GetPayoutTrail` renders to make damage
    // visible, and which nothing should create on purpose.
    const { world, useCase } = setup();

    const deleted = await useCase.execute({
      transactionId: reference.WITHDRAWAL_A.id,
    });

    expect(deleted.transactionsDeleted).toBe(3);
    await expect(
      world.transactions.findById(reference.TRANSFER_A.id),
    ).resolves.toBeNull();
    await expect(
      world.transactions.findById(reference.SALE_003.id),
    ).resolves.toBeNull();
  });

  it('takes the whole tree when the root goes', async () => {
    const { world, useCase } = setup();

    const deleted = await useCase.execute({
      transactionId: reference.CREDIT.id,
    });

    expect(deleted.transactionsDeleted).toBe(reference.TRANSACTIONS.length);
    expect(deleted.feesDeleted).toBe(reference.FEES.length);
    await expect(
      world.transactions.listByPayout(reference.PAYOUT.id),
    ).resolves.toEqual([]);
  });

  it('leaves the payout standing, with no movements', async () => {
    // Which is the state a payout is recorded in before its first leg. §13
    // derives status, so it simply reads as open again.
    const { world, useCase } = setup();

    await useCase.execute({ transactionId: reference.CREDIT.id });

    await expect(
      world.payouts.findById(reference.PAYOUT.id),
    ).resolves.not.toBeNull();
  });

  it('leaves the siblings of the deleted leg alone', async () => {
    const { world, useCase } = setup();

    await useCase.execute({ transactionId: reference.WITHDRAWAL_A.id });

    await expect(
      world.transactions.findById(reference.WITHDRAWAL_B.id),
    ).resolves.not.toBeNull();
    await expect(
      world.transactions.findById(reference.SALE_005.id),
    ).resolves.not.toBeNull();
  });

  it('reports the payout, so the caller knows which trail is now wrong', async () => {
    const { useCase } = setup();

    const deleted = await useCase.execute({
      transactionId: reference.SALE_003.id,
    });

    expect(deleted.payoutId).toBe(reference.PAYOUT.id);
    expect(deleted.transaction.code).toBe(reference.SALE_003.code);
  });

  it('refuses a leg that is not there', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ transactionId: 4242 }),
    ).rejects.toBeInstanceOf(TransactionNotFoundError);
  });
});
