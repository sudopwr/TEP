import { describe, expect, it } from 'vitest';

import { TestWorld, reference } from '../../test/fakes/world';
import { AccountInUseError, AccountNotFoundError } from '../domain/errors';

import { DeleteAccount } from './delete-account';

const useCaseFor = (world: TestWorld) =>
  new DeleteAccount({
    accounts: world.accounts,
    transactions: world.transactions,
  });

describe('DeleteAccount', () => {
  it('removes an account nothing has moved through', async () => {
    const world = TestWorld.withCounterparties();

    const deleted = await useCaseFor(world).execute({
      accountId: reference.BANK.id,
    });

    expect(deleted.code).toBe(reference.BANK.code);
    await expect(
      world.accounts.findById(reference.BANK.id),
    ).resolves.toBeNull();
  });

  it('hands back the account as it was, so the caller can name it', async () => {
    const world = TestWorld.withCounterparties();

    const deleted = await useCaseFor(world).execute({
      accountId: reference.BANK.id,
    });

    expect(deleted.name).toBe(reference.BANK.name);
  });

  it('refuses an account money has moved through, and says how much', async () => {
    // Not a constraint violation dressed up as a server fault: the sentence
    // names the account and the number of legs, so the reader knows how much
    // history they are being asked to reconsider.
    const world = TestWorld.withReferencePayout();

    const failure = await useCaseFor(world)
      .execute({ accountId: reference.COINDCX.id })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(AccountInUseError);
    expect((failure as AccountInUseError).transactionCount).toBeGreaterThan(0);
    expect((failure as AccountInUseError).message).toMatch(
      /cannot be deleted\. Delete those payouts first/,
    );
  });

  it('counts a leg that only sends from the account, as well as one that receives', async () => {
    const world = TestWorld.withReferencePayout();

    // The bank only ever receives; the prop firm only ever sends. Both are in
    // use, and a check that looked at one column would miss one of them.
    await expect(
      useCaseFor(world).execute({ accountId: reference.BANK.id }),
    ).rejects.toBeInstanceOf(AccountInUseError);
    await expect(
      useCaseFor(world).execute({ accountId: reference.TRADEIFY_ACCOUNT.id }),
    ).rejects.toBeInstanceOf(AccountInUseError);
  });

  it('leaves the account in place when it refuses', async () => {
    const world = TestWorld.withReferencePayout();

    await useCaseFor(world)
      .execute({ accountId: reference.COINDCX.id })
      .catch(() => undefined);

    await expect(
      world.accounts.findById(reference.COINDCX.id),
    ).resolves.not.toBeNull();
  });

  it('refuses an account that is not there', async () => {
    const world = TestWorld.withCounterparties();

    await expect(
      useCaseFor(world).execute({ accountId: 4242 }),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });

  it('leaves every other account standing', async () => {
    const world = TestWorld.withCounterparties();

    await useCaseFor(world).execute({ accountId: reference.BANK.id });

    await expect(
      world.accounts.findById(reference.COINDCX.id),
    ).resolves.not.toBeNull();
  });
});
