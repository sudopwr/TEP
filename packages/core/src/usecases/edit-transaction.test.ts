import { describe, expect, it } from 'vitest';

import { TestWorld, reference } from '../../test/fakes/world';
import {
  AccountNotFoundError,
  CurrencyNotAllowedError,
  RateOnSameCurrencyError,
  SameAccountTransferError,
  TransactionNotFoundError,
  UnknownCurrencyError,
} from '../domain/errors';

import {
  EditTransaction,
  type EditTransactionCommand,
} from './edit-transaction';

const setup = () => {
  const world = TestWorld.withReferencePayout();
  const useCase = new EditTransaction({
    transactions: world.transactions,
    accounts: world.accounts,
    currencies: world.currencies,
  });

  return { world, useCase };
};

/** Transfer A as it stands: TrustWallet → CoinDCX, USDT both sides, no rate. */
const command = (
  overrides: Partial<EditTransactionCommand> = {},
): EditTransactionCommand => ({
  transactionId: reference.TRANSFER_A.id,
  code: reference.TRANSFER_A.code,
  txnDate: reference.TRANSFER_A.txnDate,
  fromAccountId: reference.TRUSTWALLET.id,
  toAccountId: reference.COINDCX.id,
  fromAmount: '222.00000000',
  fromCurrencyCode: 'USDT',
  toAmount: '221.50000000',
  toCurrencyCode: 'USDT',
  rate: null,
  ...overrides,
});

describe('EditTransaction', () => {
  it('corrects the amounts, keeping the leg where it is', async () => {
    const { world, useCase } = setup();

    const edited = await useCase.execute(command());

    expect(edited.id).toBe(reference.TRANSFER_A.id);
    expect(edited.fromAmount.toDecimalString()).toBe('222.00000000');
    expect(edited.toAmount.toDecimalString()).toBe('221.50000000');
    await expect(
      world.transactions.findById(reference.TRANSFER_A.id),
    ).resolves.toEqual(edited);
  });

  it('carries the payout, the parent and the kind forward untouched', async () => {
    // None of the three is a correction of this row: moving a leg between
    // payouts re-files a subtree, re-parenting restructures the tree, and
    // changing kind would mean running §8's fee engine.
    const { useCase } = setup();

    const edited = await useCase.execute(command({ code: 'Renamed' }));

    expect(edited.payoutId).toBe(reference.TRANSFER_A.payoutId);
    expect(edited.parentId).toBe(reference.TRANSFER_A.parentId);
    expect(edited.kind).toBe(reference.TRANSFER_A.kind);
  });

  it('moves a leg to different accounts', async () => {
    const { useCase } = setup();

    const edited = await useCase.execute(
      command({
        fromAccountId: reference.RISE.id,
        toAccountId: reference.TRUSTWALLET.id,
      }),
    );

    expect(edited.fromAccountId).toBe(reference.RISE.id);
    expect(edited.toAccountId).toBe(reference.TRUSTWALLET.id);
  });

  it('changes the date and the notes', async () => {
    const { useCase } = setup();

    const edited = await useCase.execute(
      command({ txnDate: '2025-03-14', notes: 'Corrected from the statement' }),
    );

    expect(edited.txnDate).toBe('2025-03-14');
    expect(edited.notes).toBe('Corrected from the statement');
  });

  it('refuses a leg that is not there', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ transactionId: 4242 })),
    ).rejects.toBeInstanceOf(TransactionNotFoundError);
  });

  it('refuses an account that is not there', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ toAccountId: 999 })),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });

  it('refuses a move from an account to itself', async () => {
    // The entity's invariant, reached by rebuilding it — an edit can break
    // exactly what an insert can.
    const { useCase } = setup();

    await expect(
      useCase.execute({
        ...command(),
        toAccountId: reference.TRUSTWALLET.id,
      }),
    ).rejects.toBeInstanceOf(SameAccountTransferError);
  });

  it('refuses a rate on a same-currency move', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ rate: 9766520000n })),
    ).rejects.toBeInstanceOf(RateOnSameCurrencyError);
  });

  it('refuses a currency the destination cannot hold', async () => {
    // §7's one impossible currency rule, applied to the edit as to the insert.
    const { useCase } = setup();

    await expect(
      useCase.execute(
        command({ toCurrencyCode: 'INR', fromCurrencyCode: 'INR' }),
      ),
    ).rejects.toBeInstanceOf(CurrencyNotAllowedError);
  });

  it('refuses a currency the ledger does not know', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(command({ toCurrencyCode: 'XYZ' })),
    ).rejects.toBeInstanceOf(UnknownCurrencyError);
  });

  it('leaves the fees exactly as they were', async () => {
    // TDS came off a statement and is the only authority for what was
    // withheld; §7's checks report a fee that no longer matches the schedule,
    // which is the flag this edit is allowed to raise rather than silence.
    const { world, useCase } = setup();
    const before = await world.transactions.listFeesByTransaction(
      reference.SALE_003.id,
    );

    await useCase.execute(
      command({
        transactionId: reference.SALE_003.id,
        code: reference.SALE_003.code,
        txnDate: reference.SALE_003.txnDate,
        fromAccountId: reference.COINDCX.id,
        toAccountId: reference.BANK.id,
        fromAmount: '100.00000000',
        fromCurrencyCode: 'USDT',
        toAmount: '9000.00',
        toCurrencyCode: 'INR',
        rate: 9000000000n,
      }),
    );

    await expect(
      world.transactions.listFeesByTransaction(reference.SALE_003.id),
    ).resolves.toEqual(before);
  });

  it('leaves every other leg alone', async () => {
    const { world, useCase } = setup();

    await useCase.execute(command({ code: 'Renamed' }));

    await expect(
      world.transactions.findById(reference.SALE_003.id),
    ).resolves.toEqual(reference.SALE_003);
  });
});
