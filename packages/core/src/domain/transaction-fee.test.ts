import { describe, expect, it } from 'vitest';

import { INR, USD } from './currency';
import { NonPositiveAmountError } from './errors';
import { Money } from './money';
import { TransactionFee } from './transaction-fee';

const tds = () =>
  TransactionFee.record({
    id: 5,
    transactionId: 3,
    feeType: 'tds',
    amount: Money.fromDecimalString('44.89', INR),
  });

describe('TransactionFee', () => {
  it('carries its type, its transaction, and its own currency', () => {
    const fee = tds();

    expect(fee.feeType).toBe('tds');
    expect(fee.transactionId).toBe(3);
    expect(fee.amount.toDecimalString()).toBe('44.89');
    expect(fee.amount.currency.code).toBe('INR');
  });

  it('carries a currency independent of the transaction — the Rise fee is USD', () => {
    const network = TransactionFee.record({
      id: 1,
      transactionId: 2,
      feeType: 'network_fee',
      amount: Money.fromDecimalString('4.03', USD),
    });

    expect(network.isDenominatedIn(USD)).toBe(true);
    expect(network.isDenominatedIn(INR)).toBe(false);
  });

  it('accepts a zero fee, which is a recorded fact rather than an error', () => {
    expect(() =>
      TransactionFee.record({
        id: 2,
        transactionId: 3,
        feeType: 'gst',
        amount: Money.zero(INR),
      }),
    ).not.toThrow();
  });

  it('rejects a negative fee', () => {
    expect(() =>
      TransactionFee.record({
        id: 3,
        transactionId: 3,
        feeType: 'gst',
        amount: Money.fromMinor(-1n, INR),
      }),
    ).toThrow(NonPositiveAmountError);
  });

  it('restates the amount into a new instance', () => {
    const original = tds();
    const corrected = original.withAmount(
      Money.fromDecimalString('45.00', INR),
    );

    expect(corrected.amount.toDecimalString()).toBe('45.00');
    expect(original.amount.toDecimalString()).toBe('44.89');
    expect(corrected).not.toBe(original);
  });

  it('rejects a restated amount that is negative', () => {
    expect(() => tds().withAmount(Money.fromMinor(-1n, INR))).toThrow(
      NonPositiveAmountError,
    );
  });
});
