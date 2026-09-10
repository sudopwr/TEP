import { describe, expect, it } from 'vitest';

import { INR, USD, USDT } from './currency';
import {
  NonPositiveAmountError,
  ParentPayoutMismatchError,
  RateOnSameCurrencyError,
  SameAccountTransferError,
} from './errors';
import { Money } from './money';
import { Transaction, type TransactionProps } from './transaction';

const sale = (overrides: Partial<TransactionProps> = {}): Transaction =>
  Transaction.record({
    id: 3,
    code: 'Transaction003',
    payoutId: 1,
    parentId: null,
    txnDate: '2025-03-16',
    kind: 'sale',
    fromAccountId: 4,
    toAccountId: 5,
    fromAmount: Money.fromDecimalString('45.2292', USDT),
    toAmount: Money.fromDecimalString('4444.28', INR),
    rate: 9826120000n,
    ...overrides,
  });

const transfer = (overrides: Partial<TransactionProps> = {}): Transaction =>
  Transaction.record({
    id: 7,
    code: 'Transaction007',
    payoutId: 1,
    parentId: null,
    txnDate: '2025-03-15',
    kind: 'transfer',
    fromAccountId: 3,
    toAccountId: 4,
    fromAmount: Money.fromDecimalString('222.44', USDT),
    toAmount: Money.fromDecimalString('222.44', USDT),
    rate: null,
    ...overrides,
  });

describe('Transaction', () => {
  describe('construction', () => {
    it('records a well-formed leg', () => {
      const leg = sale();

      expect(leg.code).toBe('Transaction003');
      expect(leg.kind).toBe('sale');
      expect(leg.rate).toBe(9826120000n);
      expect(leg.parentId).toBeNull();
    });

    it('throws SameAccountTransferError when both sides are one account', () => {
      expect(() => transfer({ fromAccountId: 4, toAccountId: 4 })).toThrow(
        SameAccountTransferError,
      );
    });

    it('carries structured fields on the same-account error', () => {
      try {
        transfer({ fromAccountId: 4, toAccountId: 4 });
        expect.unreachable('record should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SameAccountTransferError);
        const failure = error as SameAccountTransferError;
        expect(failure.transactionCode).toBe('Transaction007');
        expect(failure.accountId).toBe(4);
      }
    });

    it('throws RateOnSameCurrencyError when a rate rides a same-currency move', () => {
      expect(() => transfer({ rate: 100000000n })).toThrow(
        RateOnSameCurrencyError,
      );
    });

    it('carries structured fields on the rate error', () => {
      try {
        transfer({ rate: 100000000n });
        expect.unreachable('record should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RateOnSameCurrencyError);
        const failure = error as RateOnSameCurrencyError;
        expect(failure.transactionCode).toBe('Transaction007');
        expect(failure.currencyCode).toBe('USDT');
        expect(failure.rate).toBe(100000000n);
      }
    });

    it('accepts a null rate on a same-currency move', () => {
      expect(() => transfer({ rate: null })).not.toThrow();
    });

    it('accepts a rate on a cross-currency move', () => {
      expect(() => sale({ rate: 9826120000n })).not.toThrow();
    });

    it('accepts a null rate on a cross-currency move', () => {
      // CLAUDE.md §7: the reverse implication is deliberately not enforced —
      // a rate may be unknown at entry time. v_data_quality flags it instead.
      expect(() => sale({ rate: null })).not.toThrow();
    });

    it('throws NonPositiveAmountError on a zero or negative from-amount', () => {
      expect(() => transfer({ fromAmount: Money.zero(USDT) })).toThrow(
        NonPositiveAmountError,
      );
      expect(() =>
        transfer({ fromAmount: Money.fromMinor(-1n, USDT) }),
      ).toThrow(NonPositiveAmountError);
    });

    it('throws NonPositiveAmountError on a zero or negative to-amount', () => {
      expect(() => transfer({ toAmount: Money.zero(USDT) })).toThrow(
        NonPositiveAmountError,
      );
      expect(() => transfer({ toAmount: Money.fromMinor(-1n, USDT) })).toThrow(
        NonPositiveAmountError,
      );
    });

    it('names which side failed', () => {
      try {
        transfer({ toAmount: Money.zero(USDT) });
        expect.unreachable('record should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NonPositiveAmountError);
        expect((error as NonPositiveAmountError).field).toBe('toAmount');
      }
    });
  });

  describe('grossProceeds', () => {
    it('multiplies the from-amount by the rate when a rate exists', () => {
      // 45.2292 USDT at 98.2612 is 4444.27546704, rounding to ₹4,444.28.
      const proceeds = sale().grossProceeds();

      expect(proceeds.currency.code).toBe('INR');
      expect(proceeds.minor).toBe(444428n);
      expect(proceeds.toDecimalString()).toBe('4444.28');
    });

    it('ignores the recorded to-amount when a rate exists', () => {
      const proceeds = sale({
        toAmount: Money.fromDecimalString('1.00', INR),
      }).grossProceeds();

      expect(proceeds.minor).toBe(444428n);
    });

    it('falls back to the to-amount when there is no rate', () => {
      const proceeds = sale({ rate: null }).grossProceeds();

      expect(proceeds.minor).toBe(444428n);
      expect(proceeds.currency.code).toBe('INR');
    });

    it('returns the to-amount for a same-currency move', () => {
      expect(transfer().grossProceeds().toDecimalString()).toBe('222.44000000');
    });

    it('honours an explicit rounding mode', () => {
      expect(sale().grossProceeds('toward-zero').minor).toBe(444427n);
      expect(sale().grossProceeds('half-up').minor).toBe(444428n);
    });
  });

  describe('isSale', () => {
    it('is true only for the sale kind', () => {
      expect(sale().isSale()).toBe(true);
      expect(transfer().isSale()).toBe(false);
      expect(transfer({ kind: 'withdrawal' }).isSale()).toBe(false);
      expect(transfer({ kind: 'payout_credit' }).isSale()).toBe(false);
    });
  });

  describe('attachTo', () => {
    it('sets the parent id in a new instance', () => {
      const parent = transfer();
      const child = sale();
      const attached = child.attachTo(parent);

      expect(attached.parentId).toBe(7);
      expect(child.parentId).toBeNull();
      expect(attached).not.toBe(child);
    });

    it('throws ParentPayoutMismatchError across payouts', () => {
      const foreign = transfer({ payoutId: 2, code: 'Transaction099' });

      expect(() => sale().attachTo(foreign)).toThrow(ParentPayoutMismatchError);
    });

    it('carries structured fields on the parent mismatch', () => {
      const foreign = transfer({ payoutId: 2, code: 'Transaction099' });

      try {
        sale().attachTo(foreign);
        expect.unreachable('attachTo should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ParentPayoutMismatchError);
        const failure = error as ParentPayoutMismatchError;
        expect(failure.childCode).toBe('Transaction003');
        expect(failure.childPayoutId).toBe(1);
        expect(failure.parentCode).toBe('Transaction099');
        expect(failure.parentPayoutId).toBe(2);
      }
    });

    it('keeps every other field', () => {
      const attached = sale().attachTo(transfer());

      expect(attached.code).toBe('Transaction003');
      expect(attached.fromAmount.minor).toBe(4522920000n);
      expect(attached.rate).toBe(9826120000n);
    });
  });

  describe('immutability', () => {
    it('returns a new instance from withNotes', () => {
      const original = sale();
      const noted = original.withNotes('sold in two fills');

      expect(noted.notes).toBe('sold in two fills');
      expect(original.notes).toBeNull();
    });

    it('does not expose a setter for the amounts', () => {
      const leg = sale();

      expect(() => {
        (leg as unknown as { fromAmount: Money }).fromAmount = Money.zero(USD);
      }).toThrow();
    });
  });
});
