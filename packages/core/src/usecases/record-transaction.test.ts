import { describe, expect, it } from 'vitest';

import { TestWorld } from '../../test/fakes/world';
import { USD } from '../domain/currency';
import {
  AccountNotFoundError,
  CurrencyNotAllowedError,
  NonPositiveAmountError,
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
  traderId: 1,
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

describe('the chain fields (F28)', () => {
  // TrustWallet -> CoinDCX, USDT both sides: the leg the three fields exist
  // for. They are optional columns, so the checks are about what is kept,
  // not about what is refused.
  const ADDRESSES = {
    fromAddress: 'TQ5NMqJjW3kG4pM4Y7mHs2jWc1ZLsz9Xsa',
    toAddress: '0x8f3a1c4b2d5e6f708192a3b4c5d6e7f809a1b2c3',
    explorerUrl: 'https://tronscan.org/#/transaction/9f2c',
  } as const;

  it('keeps both addresses and the link on the leg', async () => {
    const { useCase } = setup();

    const leg = await useCase.execute(command(ADDRESSES));

    expect(leg.fromAddress).toBe(ADDRESSES.fromAddress);
    expect(leg.toAddress).toBe(ADDRESSES.toAddress);
    expect(leg.explorerUrl).toBe(ADDRESSES.explorerUrl);
  });

  it('reads them back from the repository, not just from the return value', async () => {
    const { world, useCase } = setup();

    const leg = await useCase.execute(command(ADDRESSES));
    const stored = await world.transactions.findById(leg.id);

    expect(stored?.fromAddress).toBe(ADDRESSES.fromAddress);
    expect(stored?.explorerUrl).toBe(ADDRESSES.explorerUrl);
  });

  it('leaves them null when the leg never touched a chain', async () => {
    const { useCase } = setup();

    const leg = await useCase.execute(command());

    expect(leg.fromAddress).toBeNull();
    expect(leg.toAddress).toBeNull();
    expect(leg.explorerUrl).toBeNull();
  });

  it('knows a token moved, which is what the fields are for', async () => {
    const { useCase } = setup();

    const usdt = await useCase.execute(command());
    const rupees = await useCase.execute(
      command({
        code: 'Transaction101',
        fromAccountId: 4,
        toAccountId: 5,
        fromAmount: '1000.00',
        fromCurrencyCode: 'INR',
        toAmount: '1000.00',
        toCurrencyCode: 'INR',
      }),
    );

    expect(usdt.movesToken()).toBe(true);
    expect(rupees.movesToken()).toBe(false);
  });

  it('takes an address on a leg that moved no token, since odd is not impossible', async () => {
    // §7's line: the checks flag what is suspicious and the schema refuses
    // only what cannot be true. An address on a rupee transfer is neither.
    const { useCase } = setup();

    const leg = await useCase.execute(
      command({
        code: 'Transaction102',
        fromAccountId: 4,
        toAccountId: 5,
        fromAmount: '1000.00',
        fromCurrencyCode: 'INR',
        toAmount: '1000.00',
        toCurrencyCode: 'INR',
        fromAddress: 'an address on a bank transfer',
      }),
    );

    expect(leg.fromAddress).toBe('an address on a bank transfer');
  });
});

describe('the charge it kept (F32)', () => {
  it('records it as a fee in the currency the leg was sent in', async () => {
    /*
      §10's withdrawal, as the sheet has it: $226.81 leaves Rise, 222.78 USDT
      arrives at the wallet at 1.00000000, and the $4.03 between them is the
      flat network fee — in dollars, because dollars are what left. The fee
      goes in the *source* currency, which is what `v_data_quality` assumes
      when it reconciles `to_amount` against the rate.
    */
    const { world, useCase } = setup();

    const leg = await useCase.execute(
      command({
        code: 'Transaction110',
        kind: 'withdrawal',
        fromAccountId: 2,
        toAccountId: 3,
        fromAmount: '226.81',
        fromCurrencyCode: 'USD',
        toAmount: '222.78',
        toCurrencyCode: 'USDT',
        rate: 100000000n,
        charge: { feeType: 'network_fee', amount: '4.03' },
      }),
    );

    const fees = await world.transactions.listFeesByTransaction(leg.id);

    expect(fees).toHaveLength(1);
    expect(fees[0]?.feeType).toBe('network_fee');
    expect(fees[0]?.amount.toString()).toBe('4.03 USD');
  });

  it('files it as a platform charge when that is what it was', async () => {
    const { world, useCase } = setup();

    const leg = await useCase.execute(
      command({
        code: 'Transaction111',
        kind: 'payout_credit',
        fromAccountId: 1,
        toAccountId: 2,
        fromAmount: '1008.01',
        fromCurrencyCode: 'USD',
        toAmount: '907.22',
        toCurrencyCode: 'USD',
        charge: { feeType: 'platform_charge', amount: '100.79' },
      }),
    );

    const fees = await world.transactions.listFeesByTransaction(leg.id);

    expect(fees[0]?.amount.toString()).toBe('100.79 USD');
    expect(fees[0]?.feeType).toBe('platform_charge');
  });

  it('records no fee at all when nothing was charged', async () => {
    // A leg that cost nothing has no fee row. Absent is not zero.
    const { world, useCase } = setup();

    const leg = await useCase.execute(command({ code: 'Transaction112' }));

    await expect(
      world.transactions.listFeesByTransaction(leg.id),
    ).resolves.toEqual([]);
  });

  it('records a zero charge that somebody typed on purpose', async () => {
    const { world, useCase } = setup();

    const leg = await useCase.execute(
      command({
        code: 'Transaction113',
        charge: { feeType: 'network_fee', amount: '0' },
      }),
    );

    const fees = await world.transactions.listFeesByTransaction(leg.id);

    expect(fees).toHaveLength(1);
    expect(fees[0]?.amount.isZero()).toBe(true);
  });

  it('refuses a negative charge, which is a refund in disguise', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute(
        command({
          code: 'Transaction114',
          charge: { feeType: 'network_fee', amount: '-1.00' },
        }),
      ),
    ).rejects.toThrow(NonPositiveAmountError);
  });

  it('keeps the leg it charged, and charges the leg it kept', async () => {
    // The fee hangs off this transaction and no other: the reference tree
    // already has fees on other legs, and a charge must not join them.
    const { world, useCase } = setup();

    const leg = await useCase.execute(
      command({
        code: 'Transaction115',
        charge: { feeType: 'network_fee', amount: '0.44' },
      }),
    );

    const fees = await world.transactions.listFeesByTransaction(leg.id);

    expect(fees).toHaveLength(1);
    expect(fees[0]?.transactionId).toBe(leg.id);
    expect(fees[0]?.amount.toString()).toBe('0.44000000 USDT');
  });
});
